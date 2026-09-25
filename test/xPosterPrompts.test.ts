import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db/client";
import { callClaude } from "../src/xPoster/claudeClient";
import { buildArticleUrlSectionNote, generatePost } from "../src/xPoster/generatePost";
import { generateStandalonePost } from "../src/xPoster/generateStandalonePost";
import { generateUrlThreadPost } from "../src/xPoster/generateUrlThreadPost";
import { generateBehindTheScenesPost } from "../src/xPoster/generateBehindTheScenesPost";
import { buildRecentOpeningsHint } from "../src/xPoster/varietyHint";
import { loadXPosterConfig } from "../src/xPoster/config";

vi.mock("../src/xPoster/claudeClient", () => ({ callClaude: vi.fn() }));

const windows = { recentFeedbackWindow: 5, recentPostsForVarietyWindow: 5, recentOpeningsWindow: 30 };
const article = { articleId: "article-1", articleTitle: "記事", articleContent: "本文です" };

beforeEach(async () => {
  vi.mocked(callClaude).mockReset();
  await prisma.xPost.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("buildRecentOpeningsHint", () => {
  it("returns null when nothing has been posted yet", async () => {
    expect(await buildRecentOpeningsHint(30)).toBeNull();
  });

  it("lists posted openings across all kinds, newest first, flattened and truncated", async () => {
    await prisma.xPost.create({
      data: { generatedText: "x", finalText: "古い単発の書き出し", status: "posted", postKind: "standalone", createdAt: new Date("2026-09-01") },
    });
    await prisma.xPost.create({
      data: {
        generatedText: "x",
        finalText: `新しい記事紹介\n\n${"あ".repeat(80)}`,
        status: "posted",
        postKind: "promo",
        createdAt: new Date("2026-09-02"),
      },
    });
    await prisma.xPost.create({
      data: { generatedText: "x", finalText: "承認待ちの投稿", status: "pending_approval" },
    });

    const hint = await buildRecentOpeningsHint(30);
    expect(hint).not.toBeNull();
    expect(hint!.indexOf("新しい記事紹介")).toBeLessThan(hint!.indexOf("古い単発の書き出し"));
    expect(hint).toContain(`- 新しい記事紹介 ${"あ".repeat(52)}…`);
    expect(hint).not.toContain("承認待ちの投稿");
  });

  it("respects the window size", async () => {
    for (let i = 0; i < 3; i++) {
      await prisma.xPost.create({
        data: { generatedText: "x", finalText: `投稿${i}`, status: "posted", createdAt: new Date(2026, 8, i + 1) },
      });
    }
    const hint = await buildRecentOpeningsHint(2);
    expect(hint).toContain("投稿2");
    expect(hint).toContain("投稿1");
    expect(hint).not.toContain("投稿0");
  });
});

describe("buildArticleUrlSectionNote", () => {
  it("asks for the URL when one is given", () => {
    expect(buildArticleUrlSectionNote("https://note.com/x", true)).toContain("記事URL");
  });

  it("keeps the teaser for unpublished articles", () => {
    expect(buildArticleUrlSectionNote(undefined, false)).toContain("余韻");
  });

  it("forbids mentioning the article when published but no URL is available", () => {
    const note = buildArticleUrlSectionNote(undefined, true);
    expect(note).toContain("記事の存在には触れず");
    expect(note).not.toContain("余韻");
  });
});

describe("generation prompts", () => {
  it("render every template with the account-wide openings and without the old cut-off instruction", async () => {
    await prisma.xPost.create({
      data: { generatedText: "x", finalText: "別種別で使った書き出し", status: "posted", postKind: "standalone" },
    });
    vi.mocked(callClaude).mockResolvedValue(JSON.stringify({ hook: "1件目", payoff: "2件目" }));

    await generatePost("m", { ...article, ...windows, published: true, charLimit: 280, trendWordsLimit: 5 });
    await generateStandalonePost("m", { ...windows, charLimit: 280, trendWordsLimit: 5 });
    await generateUrlThreadPost("m", { ...article, ...windows, charLimit: 280, trendWordsLimit: 5 });
    await generateBehindTheScenesPost("m", {
      ...article,
      ...windows,
      topic: "theme",
      planTheme: "テーマ",
      planTargetReader: "読者",
      planTitleCandidatesJson: JSON.stringify(["候補"]),
      planStructure: "## 導入",
      charLimit: 280,
    });

    const prompts = vi.mocked(callClaude).mock.calls.map(([, prompt]) => prompt);
    expect(prompts).toHaveLength(4);
    for (const prompt of prompts) {
      expect(prompt).toContain("別種別で使った書き出し");
      expect(prompt).toContain("型の固定化");
      expect(prompt).not.toContain("話が完結する手前で切って");
      expect(prompt).not.toContain("「文が完結していない」状態で");
    }
  });
});

describe("x-poster config", () => {
  it("posts at most a few times a day with spacing between posts", () => {
    const config = loadXPosterConfig();
    expect(config.targetPostsPerDay).toBeLessThanOrEqual(3);
    expect(config.minSpacingHours).toBeGreaterThanOrEqual(3);
    expect(config.recentOpeningsWindow).toBeGreaterThan(config.recentPostsForVarietyWindow);
  });
});
