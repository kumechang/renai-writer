import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db/client";
import { callClaude } from "../src/xPoster/claudeClient";
import {
  bookmarkReviewSchema,
  buildBookmarkReviewSection,
  countBookmarkers,
  loadReaderPersonas,
} from "../src/xPoster/bookmarkReview";
import { selfCheckSchema } from "../src/xPoster/selfCheckPost";
import { selfCheckPost } from "../src/xPoster/selfCheckPost";
import { selfCheckStandalonePost } from "../src/xPoster/selfCheckStandalonePost";
import { selfCheckUrlThreadPost } from "../src/xPoster/selfCheckUrlThreadPost";
import { selfCheckBehindTheScenesPost } from "../src/xPoster/selfCheckBehindTheScenesPost";
import { isSaveWorthyPass, selfCheckSaveWorthyPost } from "../src/xPoster/selfCheckSaveWorthyPost";
import {
  generateSaveWorthyPost,
  pickSaveWorthyType,
  SAVE_WORTHY_POST_KIND,
  SAVE_WORTHY_TYPES,
} from "../src/xPoster/generateSaveWorthyPost";
import { buildIssueBody } from "../src/xPoster/approvalIssue";
import { buildVarietyHint } from "../src/xPoster/varietyHint";

vi.mock("../src/xPoster/claudeClient", () => ({ callClaude: vi.fn() }));

const saved = { persona: "美咲", would_bookmark: true, reason: "次の夜に使える" };
const skipped = { persona: "由佳", would_bookmark: false, reason: "持ち帰れる情報がない" };

function selfCheckResponse(extra: Record<string, unknown>): string {
  return JSON.stringify({ score: 90, pass: true, problems: [], improvements: [], ...extra });
}

describe("bookmarkReviewSchema", () => {
  it("defaults to an empty list when the self-check omits the verdicts", () => {
    const parsed = selfCheckSchema.parse({ score: 80, pass: true, problems: [], improvements: [], final_post: "本文" });
    expect(parsed.bookmark_review).toEqual([]);
  });

  it("counts only personas that would bookmark", () => {
    expect(countBookmarkers(bookmarkReviewSchema.parse([saved, skipped]))).toBe(1);
  });
});

describe("buildBookmarkReviewSection", () => {
  it("embeds the personas and keeps the verdict out of the score when informational", () => {
    const section = buildBookmarkReviewSection("## 美咲(28歳)", false);
    expect(section).toContain("## 美咲(28歳)");
    expect(section).toContain("bookmark_review");
    expect(section).toContain("含めないでください");
  });

  it("makes the verdict part of pass/fail when it affects the score", () => {
    expect(buildBookmarkReviewSection("## 美咲", true)).toContain("不合格");
  });

  it("loads the persona config shipped with the repo", () => {
    const personas = loadReaderPersonas();
    expect(personas).toContain("美咲");
    expect(personas).toContain("由佳");
    expect(personas).toContain("彩");
  });
});

describe("isSaveWorthyPass", () => {
  it("fails a high-scoring post that no persona would bookmark", () => {
    expect(isSaveWorthyPass({ score: 95, bookmark_review: [skipped] }, 75)).toBe(false);
  });

  it("fails a post below the threshold even if a persona would bookmark it", () => {
    expect(isSaveWorthyPass({ score: 60, bookmark_review: [saved] }, 75)).toBe(false);
  });

  it("passes when the score clears the threshold and at least one persona bookmarks", () => {
    expect(isSaveWorthyPass({ score: 80, bookmark_review: [saved, skipped] }, 75)).toBe(true);
  });
});

describe("pickSaveWorthyType", () => {
  it("maps the random value across all types, clamping at the upper edge", () => {
    expect(pickSaveWorthyType(() => 0)).toBe(SAVE_WORTHY_TYPES[0]);
    expect(pickSaveWorthyType(() => 0.5)).toBe(SAVE_WORTHY_TYPES[1]);
    expect(pickSaveWorthyType(() => 0.999)).toBe(SAVE_WORTHY_TYPES[SAVE_WORTHY_TYPES.length - 1]);
    expect(pickSaveWorthyType(() => 1)).toBe(SAVE_WORTHY_TYPES[SAVE_WORTHY_TYPES.length - 1]);
  });
});

describe("buildIssueBody bookmark review", () => {
  const base = {
    articleTitle: null,
    finalText: "本文",
    score: 90,
    pass: true,
    problems: [],
    improvements: [],
    repoOwner: "kumechang",
    repoName: "renai-writer",
    sourceIssueNumber: null,
  };

  it("lists each persona's verdict with a saved count", () => {
    const body = buildIssueBody({ ...base, bookmarkReview: [saved, skipped] });
    expect(body).toContain("1 / 2人が保存");
    expect(body).toContain("美咲: 保存する — 次の夜に使える");
    expect(body).toContain("由佳: 保存しない — 持ち帰れる情報がない");
  });

  it("omits the section when there are no verdicts", () => {
    expect(buildIssueBody({ ...base, bookmarkReview: [] })).not.toContain("保存判定");
  });
});

describe("self-check prompts with bookmark review", () => {
  beforeEach(() => {
    vi.mocked(callClaude).mockReset();
  });

  it("renders every self-check template and keeps bookmark verdicts informational for existing kinds", async () => {
    vi.mocked(callClaude).mockResolvedValue(
      selfCheckResponse({ final_post: "本文", final_hook: "1件目", final_payoff: "2件目", bookmark_review: [skipped] })
    );
    const common = { charLimit: 280, passThreshold: 75 };
    const article = { articleTitle: "記事", articleContent: "本文です" };

    const results = await Promise.all([
      selfCheckPost("m", { ...common, ...article, generatedPost: "本文", published: true }),
      selfCheckStandalonePost("m", { ...common, hook: "1件目", payoff: "2件目" }),
      selfCheckUrlThreadPost("m", { ...common, ...article, hook: "1件目", payoff: "2件目", articleUrl: "https://note.com/x" }),
      selfCheckBehindTheScenesPost("m", {
        ...common,
        ...article,
        generatedPost: "本文",
        topicMaterialInput: {
          topic: "theme",
          articleTitle: "記事",
          planTheme: "テーマ",
          planTargetReader: "読者",
          planTitleCandidatesJson: JSON.stringify(["候補"]),
          planStructure: "## 導入",
        },
      }),
    ]);

    for (const { data } of results) {
      expect(data.pass).toBe(true);
      expect(data.bookmark_review).toEqual([skipped]);
    }
    for (const [, prompt] of vi.mocked(callClaude).mock.calls) {
      expect(prompt).toContain("保存(ブックマーク)判定");
      expect(prompt).toContain("美咲");
    }
  });

  it("fails a save-worthy post that no persona would bookmark", async () => {
    vi.mocked(callClaude).mockResolvedValue(selfCheckResponse({ final_post: "本文", bookmark_review: [skipped] }));
    const { data } = await selfCheckSaveWorthyPost("m", {
      generatedPost: "本文",
      saveType: SAVE_WORTHY_TYPES[0],
      charLimit: 280,
      passThreshold: 75,
    });
    expect(data.pass).toBe(false);
    const prompt = vi.mocked(callClaude).mock.calls[0][1];
    expect(prompt).toContain(SAVE_WORTHY_TYPES[0].label);
    expect(prompt).toContain("全角140文字");
  });
});

describe("generateSaveWorthyPost", () => {
  beforeEach(async () => {
    vi.mocked(callClaude).mockReset();
    await prisma.xPost.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("renders the prompt with the chosen type, personas, and only past save-worthy posts", async () => {
    await prisma.xPost.create({
      data: { generatedText: "過去の保存型", finalText: "過去の保存型", status: "posted", postKind: SAVE_WORTHY_POST_KIND },
    });
    await prisma.xPost.create({
      data: { generatedText: "過去の単発", finalText: "過去の単発", status: "posted", postKind: "standalone" },
    });
    vi.mocked(callClaude).mockResolvedValue("  生成された本文\n");

    const text = await generateSaveWorthyPost("m", {
      saveType: SAVE_WORTHY_TYPES[1],
      charLimit: 280,
      recentFeedbackWindow: 5,
      recentPostsForVarietyWindow: 5,
    });

    expect(text).toBe("生成された本文");
    const prompt = vi.mocked(callClaude).mock.calls[0][1];
    expect(prompt).toContain(SAVE_WORTHY_TYPES[1].label);
    expect(prompt).toContain("由佳");
    expect(prompt).toContain("過去の保存型");
    expect(prompt).not.toContain("過去の単発");
  });
});

describe("buildVarietyHint postKind scope", () => {
  it("returns null when there are no posts of that kind", async () => {
    await prisma.xPost.deleteMany();
    expect(await buildVarietyHint({ postKind: SAVE_WORTHY_POST_KIND }, 5)).toBeNull();
  });
});
