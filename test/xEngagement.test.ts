import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parseEngagementApprovalEvent } from "../src/xEngagement/approval";
import { buildEngagementIssueBody } from "../src/xEngagement/approvalIssue";
import { loadWatchAccountsConfig } from "../src/xEngagement/watchAccountsConfig";
import { isWithinReplyWindow } from "../src/xEngagement/replyWindow";
import { shouldReplyNow } from "../src/xEngagement/shouldReplyNow";
import { selectWatchedPost, skipStalePosts } from "../src/xEngagement/selectWatchedPost";
import type { XEngagementConfig } from "../src/xEngagement/config";
import { prisma } from "../src/db/client";

function writeEventPayload(payload: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "x-engagement-event-"));
  const file = path.join(dir, "event.json");
  writeFileSync(file, JSON.stringify(payload));
  return file;
}

describe("parseEngagementApprovalEvent", () => {
  it("recognizes an approval comment on an issue with the pending label", () => {
    const eventPath = writeEventPayload({
      action: "created",
      comment: { body: "承認します", user: { login: "kumechang" } },
      issue: { number: 7, labels: [{ name: "pending-x-engagement-approval" }] },
    });
    expect(parseEngagementApprovalEvent(eventPath)).toEqual({
      decision: "approve",
      issueNumber: 7,
      commenter: "kumechang",
      commentBody: "承認します",
    });
  });

  it("recognizes a rejection comment", () => {
    const eventPath = writeEventPayload({
      action: "created",
      comment: { body: "却下 少し媚びすぎ", user: { login: "kumechang" } },
      issue: { number: 7, labels: [{ name: "pending-x-engagement-approval" }] },
    });
    expect(parseEngagementApprovalEvent(eventPath).decision).toBe("reject");
  });

  it("ignores comments on issues without the pending label", () => {
    const eventPath = writeEventPayload({
      action: "created",
      comment: { body: "承認します", user: { login: "kumechang" } },
      issue: { number: 7, labels: [{ name: "pending-x-post-approval" }] },
    });
    expect(parseEngagementApprovalEvent(eventPath).decision).toBe("ignore");
  });

  it("treats comments without approval/rejection keywords as feedback", () => {
    const eventPath = writeEventPayload({
      action: "created",
      comment: { body: "もう少し短くてもよさそう", user: { login: "kumechang" } },
      issue: { number: 7, labels: [{ name: "pending-x-engagement-approval" }] },
    });
    expect(parseEngagementApprovalEvent(eventPath).decision).toBe("feedback");
  });

  it("ignores the bot's own comments to avoid self-triggering loops", () => {
    const eventPath = writeEventPayload({
      action: "created",
      comment: { body: "@kumechang により却下されました。", user: { login: "github-actions[bot]" } },
      issue: { number: 7, labels: [{ name: "pending-x-engagement-approval" }] },
    });
    expect(parseEngagementApprovalEvent(eventPath).decision).toBe("ignore");
  });
});

describe("buildEngagementIssueBody", () => {
  it("includes the target post, reply draft, score, and post URL", () => {
    const body = buildEngagementIssueBody({
      authorUsername: "example_account",
      postText: "最近こんなことを考えている、という投稿。",
      postUrl: "https://x.com/example_account/status/123",
      finalText: "分かります、私も同じことを考えていました。",
      score: 88,
      pass: true,
      problems: [],
      improvements: [],
      repoOwner: "kumechang",
      repoName: "renai-writer",
    });
    expect(body).toContain("@example_account");
    expect(body).toContain("最近こんなことを考えている、という投稿。");
    expect(body).toContain("分かります、私も同じことを考えていました。");
    expect(body).toContain("https://x.com/example_account/status/123");
    expect(body).toContain("88 / 100");
    expect(body).toContain("合格");
  });

  it("marks a failing self-check as not passed", () => {
    const body = buildEngagementIssueBody({
      authorUsername: "example_account",
      postText: "投稿本文",
      postUrl: "https://x.com/example_account/status/123",
      finalText: "リプライ本文",
      score: 40,
      pass: false,
      problems: ["当たり障りのない相槌になっている"],
      improvements: [],
      repoOwner: "kumechang",
      repoName: "renai-writer",
    });
    expect(body).toContain("不合格");
    expect(body).toContain("当たり障りのない相槌になっている");
  });
});

describe("loadWatchAccountsConfig", () => {
  it("filters out the placeholder example_account entry", () => {
    const entries = loadWatchAccountsConfig();
    expect(entries.every((e) => e.username !== "example_account")).toBe(true);
  });
});

describe("isWithinReplyWindow", () => {
  const config = { replyWindow: { startHour: 7, endHour: 24 } } as XEngagementConfig;

  it("returns true inside the window", () => {
    // 2026-09-08T03:00:00Z = JST 12:00
    expect(isWithinReplyWindow(new Date("2026-09-08T03:00:00Z"), config)).toBe(true);
  });

  it("returns false outside the window", () => {
    // 2026-09-08T20:00:00Z = JST 05:00 (翌日)
    expect(isWithinReplyWindow(new Date("2026-09-08T20:00:00Z"), config)).toBe(false);
  });
});

describe("shouldReplyNow / selectWatchedPost / skipStalePosts", () => {
  const config: XEngagementConfig = {
    approvalMode: "auto",
    claudeModel: "claude-sonnet-5",
    xCharLimit: 280,
    selfCheckPassThreshold: 75,
    maxGenerateRetries: 2,
    maxRepliesPerDay: 2,
    replyWindow: { startHour: 0, endHour: 24 },
    minSpacingMinutes: 20,
    recentFeedbackWindow: 10,
    maxPostAgeMinutes: 180,
  };

  beforeEach(async () => {
    await prisma.engagementReply.deleteMany();
    await prisma.watchedPost.deleteMany();
    await prisma.watchedAccount.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createAccount(username: string) {
    return prisma.watchedAccount.create({ data: { username } });
  }

  it("allows generating when under the daily cap and spacing requirement", async () => {
    const now = new Date();
    expect(await shouldReplyNow(config, now)).toBe(true);
  });

  it("blocks generating once the daily cap is reached", async () => {
    const account = await createAccount("cap_account");
    const now = new Date();
    for (let i = 0; i < config.maxRepliesPerDay; i++) {
      const post = await prisma.watchedPost.create({
        data: { watchedAccountId: account.id, tweetId: `t-${i}`, text: "本文", postedAt: now, status: "processing" },
      });
      await prisma.engagementReply.create({
        data: { watchedPostId: post.id, generatedText: "本文", finalText: "本文", status: "posted" },
      });
    }
    expect(await shouldReplyNow(config, now)).toBe(false);
  });

  it("blocks generating within minSpacingMinutes of the last reply", async () => {
    const account = await createAccount("spacing_account");
    const now = new Date();
    const post = await prisma.watchedPost.create({
      data: { watchedAccountId: account.id, tweetId: "t-recent", text: "本文", postedAt: now, status: "processing" },
    });
    await prisma.engagementReply.create({
      data: { watchedPostId: post.id, generatedText: "本文", finalText: "本文", status: "posted" },
    });
    expect(await shouldReplyNow(config, now)).toBe(false);
  });

  it("selects the oldest unhandled post within maxPostAgeMinutes", async () => {
    const account = await createAccount("select_account");
    const now = new Date();
    const older = new Date(now.getTime() - 60 * 60 * 1000);
    const newer = new Date(now.getTime() - 10 * 60 * 1000);
    await prisma.watchedPost.create({
      data: { watchedAccountId: account.id, tweetId: "older", text: "古い方", postedAt: older },
    });
    await prisma.watchedPost.create({
      data: { watchedAccountId: account.id, tweetId: "newer", text: "新しい方", postedAt: newer },
    });

    const selected = await selectWatchedPost(config, now);
    expect(selected?.tweetId).toBe("older");
  });

  it("ignores posts older than maxPostAgeMinutes", async () => {
    const account = await createAccount("stale_account");
    const now = new Date();
    const stale = new Date(now.getTime() - 200 * 60 * 1000);
    await prisma.watchedPost.create({
      data: { watchedAccountId: account.id, tweetId: "stale", text: "古すぎる投稿", postedAt: stale },
    });

    const selected = await selectWatchedPost(config, now);
    expect(selected).toBeNull();
  });

  it("marks stale unhandled posts as skipped", async () => {
    const account = await createAccount("skip_account");
    const now = new Date();
    const stale = new Date(now.getTime() - 200 * 60 * 1000);
    const post = await prisma.watchedPost.create({
      data: { watchedAccountId: account.id, tweetId: "to-skip", text: "古すぎる投稿", postedAt: stale },
    });

    const skippedCount = await skipStalePosts(config, now);
    expect(skippedCount).toBe(1);

    const updated = await prisma.watchedPost.findUniqueOrThrow({ where: { id: post.id } });
    expect(updated.status).toBe("skipped");
  });
});
