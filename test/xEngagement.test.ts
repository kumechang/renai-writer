import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadWatchAccountsConfig } from "../src/xEngagement/watchAccountsConfig";
import { buildReplyConsolePrompt, buildReplyReviewPrompt } from "../src/xEngagement/replyConsolePrompt";
import { buildReplyPromptIssueBody, buildReviewCommentBody } from "../src/xEngagement/promptIssue";
import { parseReviewCommentEvent, parseManualReviewTrigger } from "../src/xEngagement/reviewCommentEvent";
import { aggregateCandidates, type CandidateEntry, type DiscoveryConfig } from "../src/xEngagement/discoverAccounts";
import { buildDiscoveryIssueBody } from "../src/xEngagement/discoveryIssue";

function writeEventPayload(payload: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "x-engagement-review-event-"));
  const file = path.join(dir, "event.json");
  writeFileSync(file, JSON.stringify(payload));
  return file;
}

describe("loadWatchAccountsConfig", () => {
  it("filters out the placeholder example_account entry", () => {
    const entries = loadWatchAccountsConfig();
    expect(entries.every((e) => e.username !== "example_account")).toBe(true);
  });
});

describe("buildReplyConsolePrompt", () => {
  it("includes the author, post text, and char limit", () => {
    const prompt = buildReplyConsolePrompt({
      authorUsername: "example_account",
      postText: "最近こんなことを考えている、という投稿。",
      charLimit: 280,
    });
    expect(prompt).toContain("@example_account");
    expect(prompt).toContain("最近こんなことを考えている、という投稿。");
    expect(prompt).toContain("280文字");
  });

  it("instructs Claude to decline when the post content is not visible (link-only posts)", () => {
    const prompt = buildReplyConsolePrompt({
      authorUsername: "example_account",
      postText: "ここ https://t.co/xxxxx",
      charLimit: 280,
    });
    expect(prompt).toContain("良いリプライ案が思いつきません");
  });

  it("does not leak the editor-only HTML comment from x_account_info.md", () => {
    const prompt = buildReplyConsolePrompt({
      authorUsername: "example_account",
      postText: "最近こんなことを考えている、という投稿。",
      charLimit: 280,
    });
    expect(prompt).not.toContain("<!--");
    expect(prompt).not.toContain("-->");
  });

  it("includes the self-check criteria so drafting and checking happen in one prompt", () => {
    const prompt = buildReplyConsolePrompt({
      authorUsername: "example_account",
      postText: "最近こんなことを考えている、という投稿。",
      charLimit: 280,
    });
    expect(prompt).toContain("チェック項目");
  });
});

describe("buildReplyReviewPrompt", () => {
  it("includes the draft reply, target post, and char limit when a draft is given", () => {
    const prompt = buildReplyReviewPrompt({
      authorUsername: "example_account",
      postText: "最近こんなことを考えている、という投稿。",
      charLimit: 280,
      draftReply: "これめっちゃ分かります。自分も同じことを考えていました。",
    });
    expect(prompt).toContain("@example_account");
    expect(prompt).toContain("最近こんなことを考えている、という投稿。");
    expect(prompt).toContain("これめっちゃ分かります。自分も同じことを考えていました。");
    expect(prompt).toContain("280文字");
  });

  it("shows a placeholder instead of the draft when none is given", () => {
    const prompt = buildReplyReviewPrompt({
      authorUsername: "example_account",
      postText: "最近こんなことを考えている、という投稿。",
      charLimit: 280,
      draftReply: "",
    });
    expect(prompt).toContain("ここに、投稿しようとしているリプライ文を貼ってください");
  });

  it("does not leak the editor-only HTML comment from x_account_info.md", () => {
    const prompt = buildReplyReviewPrompt({
      authorUsername: "example_account",
      postText: "最近こんなことを考えている、という投稿。",
      charLimit: 280,
      draftReply: "",
    });
    expect(prompt).not.toContain("<!--");
    expect(prompt).not.toContain("-->");
  });
});

describe("buildReplyPromptIssueBody", () => {
  it("includes the target post, post URL, and a pasteable prompt", () => {
    const body = buildReplyPromptIssueBody({
      authorUsername: "example_account",
      postText: "最近こんなことを考えている、という投稿。",
      postUrl: "https://x.com/example_account/status/123",
      charLimit: 280,
    });
    expect(body).toContain("@example_account");
    expect(body).toContain("最近こんなことを考えている、という投稿。");
    expect(body).toContain("https://x.com/example_account/status/123");
    expect(body).toContain("Claude.ai");
    expect(body).toContain("料金は発生しません");
  });

  it("includes only one prompt (draft + self-check merged), so there is a single copy step", () => {
    const body = buildReplyPromptIssueBody({
      authorUsername: "example_account",
      postText: "最近こんなことを考えている、という投稿。",
      postUrl: "https://x.com/example_account/status/123",
      charLimit: 280,
    });
    expect(body).toContain("チェック項目");
    expect(body).not.toContain("<!--");
    expect(body).not.toContain("-->");
  });

  it("wraps the prompt in a fence longer than the ``` used inside it, so the prompt is not split mid-way", () => {
    const body = buildReplyPromptIssueBody({
      authorUsername: "example_account",
      // 投稿本文自体にも```を含むケース(通常のツイート本文はこう書かれないが、
      // フェンスの入れ子が正しく処理されているかを確認するため意図的に含める)。
      postText: "最近こんなことを考えている、という投稿。",
      postUrl: "https://x.com/example_account/status/123",
      charLimit: 280,
    });
    // プロンプト本文は投稿本文を```で囲んでいる。issue側のフェンス(````)が
    // それより長いことで、内側の```によって外側のフェンスが途中で閉じられない。
    const outerFenceCount = body.split("````").length - 1;
    expect(outerFenceCount).toBe(2);
    const betweenFences = body.split("````")[1];
    expect(betweenFences).toContain("```");
    expect(betweenFences).toContain("最近こんなことを考えている、という投稿。");
    expect(betweenFences).toContain("チェック項目");
  });
});

describe("buildReviewCommentBody", () => {
  it("includes the draft reply, target post, and a pasteable review prompt", () => {
    const body = buildReviewCommentBody({
      authorUsername: "example_account",
      postText: "最近こんなことを考えている、という投稿。",
      charLimit: 280,
      draftReply: "これめっちゃ分かります。自分も同じことを考えていました。",
    });
    expect(body).toContain("@example_account");
    expect(body).toContain("最近こんなことを考えている、という投稿。");
    expect(body).toContain("これめっちゃ分かります。自分も同じことを考えていました。");
    expect(body).toContain("Claude.ai");
    expect(body).toContain("料金は発生しません");
  });

  it("wraps the prompt in a fence longer than the ``` used inside it", () => {
    const body = buildReviewCommentBody({
      authorUsername: "example_account",
      postText: "最近こんなことを考えている、という投稿。",
      charLimit: 280,
      draftReply: "これめっちゃ分かります。",
    });
    const outerFenceCount = body.split("````").length - 1;
    expect(outerFenceCount).toBe(2);
  });
});

describe("parseReviewCommentEvent", () => {
  it("targets a comment on an issue with the x-engagement-reply-prompt label", () => {
    const eventPath = writeEventPayload({
      action: "created",
      comment: { body: "これめっちゃ分かる。", user: { login: "kumechang" } },
      issue: { number: 75, labels: [{ name: "x-engagement-reply-prompt" }] },
    });
    expect(parseReviewCommentEvent(eventPath)).toEqual({
      issueNumber: 75,
      commenter: "kumechang",
      commentBody: "これめっちゃ分かる。",
      shouldReview: true,
    });
  });

  it("ignores comments on issues without the label", () => {
    const eventPath = writeEventPayload({
      action: "created",
      comment: { body: "これめっちゃ分かる。", user: { login: "kumechang" } },
      issue: { number: 75, labels: [{ name: "auto-article" }] },
    });
    expect(parseReviewCommentEvent(eventPath).shouldReview).toBe(false);
  });

  it("ignores the bot's own comments to avoid self-triggering loops", () => {
    const eventPath = writeEventPayload({
      action: "created",
      comment: { body: "レビュー用プロンプトです。", user: { login: "github-actions[bot]" } },
      issue: { number: 75, labels: [{ name: "x-engagement-reply-prompt" }] },
    });
    expect(parseReviewCommentEvent(eventPath).shouldReview).toBe(false);
  });
});

describe("parseManualReviewTrigger", () => {
  it("extracts the issue number from a workflow_dispatch payload", () => {
    const eventPath = writeEventPayload({
      action: "workflow_dispatch",
      inputs: { issue_number: "253" },
    });
    expect(parseManualReviewTrigger(eventPath)).toEqual({ issueNumber: 253 });
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
