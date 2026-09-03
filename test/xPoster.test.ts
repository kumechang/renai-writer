import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderPrompt } from "../src/xPoster/promptLoader";
import { buildArticleExcerpt } from "../src/xPoster/generatePost";
import { getWeightedLength } from "../src/xPoster/tweetLength";
import { parseApprovalEvent } from "../src/xPoster/approval";
import { buildIssueBody } from "../src/xPoster/approvalIssue";
import type { SelfCheckResult } from "../src/xPoster/selfCheckPost";

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
      sourceIssueOwner: "kumechang",
      sourceIssueRepo: "renai-writer",
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
      sourceIssueOwner: "kumechang",
      sourceIssueRepo: "renai-writer",
      sourceIssueNumber: 12,
    });
    expect(body).toContain("不合格");
    expect(body).toContain("広告っぽい");
  });
});
