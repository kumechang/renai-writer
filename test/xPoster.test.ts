import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { renderPrompt } from "../src/xPoster/promptLoader";
import { buildArticleExcerpt } from "../src/xPoster/generatePost";
import { getWeightedLength } from "../src/xPoster/tweetLength";
import { parseApprovalEvent } from "../src/xPoster/approval";
import { buildIssueBody } from "../src/xPoster/approvalIssue";
import { selectArticleForPost } from "../src/xPoster/selectArticle";
import type { SelfCheckResult } from "../src/xPoster/selfCheckPost";
import { prisma } from "../src/db/client";

describe("renderPrompt", () => {
  it("replaces {{key}} placeholders with the given values", () => {
    expect(renderPrompt("こんにちは{{name}}さん", { name: "太郎" })).toBe("こんにちは太郎さん");
  });

  it("throws when a placeholder has no matching variable", () => {
    expect(() => renderPrompt("{{missing}}", {})).toThrow(/missing/);
  });
});

describe("buildArticleExcerpt", () => {
  it("cuts the content at the paid section marker", () => {
    const content = "無料部分の本文です。\n[PAID_SECTION]\n有料部分はここから。";
    expect(buildArticleExcerpt(content)).toBe("無料部分の本文です。");
  });

  it("truncates long content and appends an ellipsis", () => {
    const content = "あ".repeat(1000);
    const excerpt = buildArticleExcerpt(content);
    expect(excerpt.length).toBe(801);
    expect(excerpt.endsWith("…")).toBe(true);
  });

  it("uses the full content when there is no paid section marker and it is short", () => {
    expect(buildArticleExcerpt("短い本文")).toBe("短い本文");
  });
});

describe("getWeightedLength", () => {
  it("counts CJK characters as weight 2 (X/twitter-text behavior)", () => {
    expect(getWeightedLength("あいうえお")).toBe(10);
  });

  it("counts ASCII characters as weight 1", () => {
    expect(getWeightedLength("abc")).toBe(3);
  });
});

function writeEventPayload(payload: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), "x-post-event-"));
  const file = path.join(dir, "event.json");
  writeFileSync(file, JSON.stringify(payload));
  return file;
}

describe("parseApprovalEvent", () => {
  it("recognizes an approval comment on an issue with the pending label", () => {
    const eventPath = writeEventPayload({
      action: "created",
      comment: { body: "承認します", user: { login: "kumechang" } },
      issue: { number: 42, labels: [{ name: "pending-x-post-approval" }] },
    });
    expect(parseApprovalEvent(eventPath)).toEqual({
      decision: "approve",
      issueNumber: 42,
      commenter: "kumechang",
      commentBody: "承認します",
    });
  });

  it("recognizes a rejection comment", () => {
    const eventPath = writeEventPayload({
      action: "created",
      comment: { body: "却下 トーンが強すぎる", user: { login: "kumechang" } },
      issue: { number: 42, labels: [{ name: "pending-x-post-approval" }] },
    });
    expect(parseApprovalEvent(eventPath).decision).toBe("reject");
  });

  it("ignores comments on issues without the pending label", () => {
    const eventPath = writeEventPayload({
      action: "created",
      comment: { body: "承認します", user: { login: "kumechang" } },
      issue: { number: 42, labels: [{ name: "auto-article" }] },
    });
    expect(parseApprovalEvent(eventPath).decision).toBe("ignore");
  });

  it("ignores comments unrelated to approval/rejection", () => {
    const eventPath = writeEventPayload({
      action: "created",
      comment: { body: "いいですね", user: { login: "kumechang" } },
      issue: { number: 42, labels: [{ name: "pending-x-post-approval" }] },
    });
    expect(parseApprovalEvent(eventPath).decision).toBe("ignore");
  });
});

describe("buildIssueBody", () => {
  const selfCheck: SelfCheckResult = {
    score: 88,
    pass: true,
    problems: [],
    improvements: [],
    final_post: "冒頭の一文。続きは記事で。",
  };

  it("includes the final text, score, and source issue link", () => {
    const body = buildIssueBody({
      articleTitle: "テスト記事",
      finalText: "冒頭の一文。続きは記事で。",
      selfCheck,
      repoOwner: "kumechang",
      repoName: "renai-writer",
      sourceIssueNumber: 12,
    });
    expect(body).toContain("テスト記事");
    expect(body).toContain("冒頭の一文。続きは記事で。");
    expect(body).toContain("88 / 100");
    expect(body).toContain("合格");
    expect(body).toContain("kumechang/renai-writer#12");
  });

  it("marks a failing self-check as not passed", () => {
    const body = buildIssueBody({
      articleTitle: "テスト記事",
      finalText: "本文",
      selfCheck: { ...selfCheck, score: 40, pass: false, problems: ["広告っぽい"] },
      repoOwner: "kumechang",
      repoName: "renai-writer",
      sourceIssueNumber: 12,
    });
    expect(body).toContain("不合格");
    expect(body).toContain("広告っぽい");
  });

  it("omits the source issue line when the article has no known origin issue", () => {
    const body = buildIssueBody({
      articleTitle: "テスト記事",
      finalText: "本文",
      selfCheck,
      repoOwner: "kumechang",
      repoName: "renai-writer",
      sourceIssueNumber: null,
    });
    expect(body).not.toContain("記事issue:");
  });
});

describe("selectArticleForPost", () => {
  // 各テストを完全に独立させる(前のテストで作った記事が残っていると、乱択の結果が
  // どちらのテストの記事になるか不定になってしまうため)。
  beforeEach(async () => {
    await prisma.xPost.deleteMany();
    await prisma.article.deleteMany();
    await prisma.plan.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function createPlan() {
    const candidates = Array.from({ length: 50 }, (_, i) => `候補${i + 1}`);
    return prisma.plan.create({
      data: {
        theme: "テストテーマ",
        targetReader: "テスト読者",
        structure: "## 導入",
        volume: "1000字",
        paidSection: "後半を有料化",
        titleCandidates: JSON.stringify(candidates),
        recommendedTitles: JSON.stringify(candidates.slice(0, 10)),
      },
    });
  }

  it("picks only articles that are accepted and not yet promoted", async () => {
    const plan = await createPlan();

    const promotable = await prisma.article.create({
      data: { planId: plan.id, title: "宣伝対象の記事", status: "accepted" },
    });
    await prisma.article.create({
      data: { planId: plan.id, title: "レビュー中の記事", status: "in_review" },
    });
    const alreadyPosted = await prisma.article.create({
      data: { planId: plan.id, title: "投稿済みの記事", status: "accepted" },
    });
    await prisma.xPost.create({
      data: {
        articleId: alreadyPosted.id,
        draftId: "dummy-draft-id",
        generatedText: "本文",
        finalText: "本文",
        status: "posted",
      },
    });

    const selected = await selectArticleForPost();
    expect(selected.id).toBe(promotable.id);
  });

  it("allows re-selecting an article whose only XPost was rejected", async () => {
    const plan = await createPlan();
    const article = await prisma.article.create({
      data: { planId: plan.id, title: "却下後に再挑戦する記事", status: "accepted_with_reservation" },
    });
    await prisma.xPost.create({
      data: {
        articleId: article.id,
        draftId: "dummy-draft-id",
        generatedText: "本文",
        finalText: "本文",
        status: "rejected",
      },
    });

    const selected = await selectArticleForPost();
    expect(selected.id).toBe(article.id);
  });

  it("throws a clear error when there is nothing left to promote", async () => {
    await expect(selectArticleForPost()).rejects.toThrow(/宣伝可能な未投稿の記事/);
  });
});
