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
import { aggregateCandidates, type CandidateEntry, type DiscoveryConfig } from "../src/xEngagement/discoverAccounts";
import { buildDiscoveryIssueBody } from "../src/xEngagement/discoveryIssue";
import { computeActiveHours, isNearActiveHour, shouldCheckAccountNow } from "../src/xEngagement/postingTimeProfile";
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
    minPostHistoryForTimeFiltering: 8,
    activeHourWindow: 1,
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
        data: { watchedPostId: post.id, generatedText: "本文", finalText: "本文", status: "approved" },
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
      data: { watchedPostId: post.id, generatedText: "本文", finalText: "本文", status: "approved" },
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

describe("aggregateCandidates", () => {
  const config: DiscoveryConfig = {
    searchQueries: ["失恋 lang:ja"],
    minFollowers: 10000,
    maxFollowers: 500000,
    maxCandidates: 10,
  };

  function entry(overrides: Partial<CandidateEntry>): CandidateEntry {
    return {
      tweetId: "1",
      query: "失恋 lang:ja",
      username: "some_account",
      name: "Some Account",
      description: "恋愛について発信しています",
      protected: false,
      followersCount: 20000,
      ...overrides,
    };
  }

  it("keeps accounts within the follower range", () => {
    const result = aggregateCandidates([entry({})], config, new Set());
    expect(result).toHaveLength(1);
    expect(result[0].username).toBe("some_account");
  });

  it("excludes accounts below minFollowers", () => {
    const result = aggregateCandidates([entry({ followersCount: 500 })], config, new Set());
    expect(result).toHaveLength(0);
  });

  it("excludes accounts above maxFollowers", () => {
    const result = aggregateCandidates([entry({ followersCount: 2_000_000 })], config, new Set());
    expect(result).toHaveLength(0);
  });

  it("excludes protected accounts", () => {
    const result = aggregateCandidates([entry({ protected: true })], config, new Set());
    expect(result).toHaveLength(0);
  });

  it("excludes accounts already in the watch list (case-insensitive)", () => {
    const result = aggregateCandidates(
      [entry({ username: "Already_Watched" })],
      config,
      new Set(["already_watched"])
    );
    expect(result).toHaveLength(0);
  });

  it("dedupes an account matched by multiple queries, keeping the first match", () => {
    const result = aggregateCandidates(
      [
        entry({ tweetId: "1", query: "失恋 lang:ja" }),
        entry({ tweetId: "2", query: "元カレ 忘れられない lang:ja" }),
      ],
      config,
      new Set()
    );
    expect(result).toHaveLength(1);
    expect(result[0].matchedQuery).toBe("失恋 lang:ja");
  });

  it("sorts by followers count descending and truncates to maxCandidates", () => {
    const smallConfig: DiscoveryConfig = { ...config, maxCandidates: 2 };
    const result = aggregateCandidates(
      [
        entry({ username: "low", followersCount: 15000 }),
        entry({ username: "high", followersCount: 100000 }),
        entry({ username: "mid", followersCount: 50000 }),
      ],
      smallConfig,
      new Set()
    );
    expect(result.map((r) => r.username)).toEqual(["high", "mid"]);
  });
});

describe("buildDiscoveryIssueBody", () => {
  it("lists candidates sorted by followers with bio and sample tweet link", () => {
    const body = buildDiscoveryIssueBody([
      {
        username: "some_account",
        name: "Some Account",
        followersCount: 42000,
        description: "恋愛について発信しています",
        matchedQuery: "失恋 lang:ja",
        sampleTweetUrl: "https://x.com/some_account/status/1",
      },
    ]);
    expect(body).toContain("@some_account");
    expect(body).toContain("42,000人");
    expect(body).toContain("恋愛について発信しています");
    expect(body).toContain("https://x.com/some_account/status/1");
  });

  it("explains when no candidates were found", () => {
    const body = buildDiscoveryIssueBody([]);
    expect(body).toContain("見つかりませんでした");
  });
});

describe("computeActiveHours / isNearActiveHour", () => {
  it("treats each observed hour as active", () => {
    const hours = computeActiveHours([9, 21, 9, 12]);
    expect(hours).toEqual(new Set([9, 21, 12]));
  });

  it("returns true when the current hour matches an active hour exactly", () => {
    expect(isNearActiveHour(9, new Set([9, 21]), 1)).toBe(true);
  });

  it("returns true when within the window of an active hour", () => {
    expect(isNearActiveHour(10, new Set([9]), 1)).toBe(true);
    expect(isNearActiveHour(8, new Set([9]), 1)).toBe(true);
  });

  it("returns false when outside the window of every active hour", () => {
    expect(isNearActiveHour(15, new Set([9, 21]), 1)).toBe(false);
  });

  it("handles midnight wraparound correctly", () => {
    // 23時台がactiveなら、0時台(window=1)も近いとみなす
    expect(isNearActiveHour(0, new Set([23]), 1)).toBe(true);
    expect(isNearActiveHour(1, new Set([23]), 1)).toBe(false);
  });
});

describe("shouldCheckAccountNow", () => {
  const config = { minPostHistoryForTimeFiltering: 8, activeHourWindow: 1 };

  beforeEach(async () => {
    await prisma.watchedPost.deleteMany();
    await prisma.watchedAccount.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("always checks accounts with insufficient post history (bootstrap)", async () => {
    const account = await prisma.watchedAccount.create({ data: { username: "new_account" } });
    // config.minPostHistoryForTimeFiltering未満の投稿履歴しかない
    for (let i = 0; i < 3; i++) {
      await prisma.watchedPost.create({
        data: {
          watchedAccountId: account.id,
          tweetId: `bootstrap-${i}`,
          text: "本文",
          // 現在時刻から大きく離れた時間帯の投稿だけにしても、履歴不足なら毎回チェックする
          postedAt: new Date("2026-01-01T15:00:00Z"),
        },
      });
    }
    // 2026-09-08T00:00:00Z = JST 09:00 (投稿履歴の時間帯とは無関係のはず)
    const now = new Date("2026-09-08T00:00:00Z");
    expect(await shouldCheckAccountNow(account.id, now, config)).toBe(true);
  });

  it("skips accounts whose current time is far from their usual posting hours", async () => {
    const account = await prisma.watchedAccount.create({ data: { username: "night_owl" } });
    // JST 22時台に繰り返し投稿している十分な履歴を作る(config.minPostHistoryForTimeFiltering以上)
    for (let i = 0; i < 10; i++) {
      await prisma.watchedPost.create({
        data: {
          watchedAccountId: account.id,
          tweetId: `night-${i}`,
          text: "本文",
          postedAt: new Date("2026-01-01T13:00:00Z"), // JST 22:00
        },
      });
    }
    // 2026-09-08T00:00:00Z = JST 09:00 (22時から離れている)
    const now = new Date("2026-09-08T00:00:00Z");
    expect(await shouldCheckAccountNow(account.id, now, config)).toBe(false);
  });

  it("checks accounts whose current time is near their usual posting hours", async () => {
    const account = await prisma.watchedAccount.create({ data: { username: "morning_person" } });
    for (let i = 0; i < 10; i++) {
      await prisma.watchedPost.create({
        data: {
          watchedAccountId: account.id,
          tweetId: `morning-${i}`,
          text: "本文",
          postedAt: new Date("2026-01-01T00:00:00Z"), // JST 09:00
        },
      });
    }
    // 2026-09-08T00:00:00Z = JST 09:00 (投稿履歴と一致)
    const now = new Date("2026-09-08T00:00:00Z");
    expect(await shouldCheckAccountNow(account.id, now, config)).toBe(true);
  });
});
