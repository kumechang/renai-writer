import { describe, expect, it } from "vitest";
import { loadWatchAccountsConfig } from "../src/xEngagement/watchAccountsConfig";
import { buildReplyConsolePrompt, buildReplyReviewPrompt } from "../src/xEngagement/replyConsolePrompt";
import { buildReplyPromptIssueBody } from "../src/xEngagement/promptIssue";
import { aggregateCandidates, type CandidateEntry, type DiscoveryConfig } from "../src/xEngagement/discoverAccounts";
import { buildDiscoveryIssueBody } from "../src/xEngagement/discoveryIssue";

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

  it("includes both the generation prompt and the review prompt, and neither leaks the HTML comment", () => {
    const body = buildReplyPromptIssueBody({
      authorUsername: "example_account",
      postText: "最近こんなことを考えている、という投稿。",
      postUrl: "https://x.com/example_account/status/123",
      charLimit: 280,
    });
    expect(body).toContain("リプライ案の作成");
    expect(body).toContain("レビュー用プロンプト");
    expect(body).not.toContain("<!--");
    expect(body).not.toContain("-->");
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
