import { describe, expect, it } from "vitest";
import { formatArticleVarietyHint } from "../src/agents/writer/varietyHint";

describe("formatArticleVarietyHint", () => {
  it("returns null when there are no sibling drafts", () => {
    expect(formatArticleVarietyHint([])).toBeNull();
  });

  it("returns null when the only sibling has an empty free part", () => {
    expect(
      formatArticleVarietyHint([{ title: "記事A", content: "[PAID_SECTION]\n有料部分だけ" }])
    ).toBeNull();
  });

  it("includes each sibling's free-part opening, truncated, keyed by title", () => {
    const hint = formatArticleVarietyHint([
      { title: "記事A", content: "深夜0時、スマホを眺めている。\n[PAID_SECTION]\n有料部分" },
      { title: "記事B", content: "既読なのに返信が来ない。\n[PAID_SECTION]\n有料部分" },
    ]);

    expect(hint).toContain("記事A");
    expect(hint).toContain("深夜0時、スマホを眺めている。");
    expect(hint).toContain("記事B");
    expect(hint).toContain("既読なのに返信が来ない。");
  });

  it("truncates a long opening and appends an ellipsis", () => {
    const longOpening = "あ".repeat(400);
    const hint = formatArticleVarietyHint([{ title: "記事A", content: `${longOpening}\n[PAID_SECTION]\n有料部分` }]);

    expect(hint).toContain("あ".repeat(300) + "…");
    expect(hint).not.toContain("あ".repeat(301));
  });

  it("detects the legacy HTML-comment marker when that's what the draft uses", () => {
    const hint = formatArticleVarietyHint([
      { title: "記事A", content: "旧マーカーの書き出し\n<!-- PAID_SECTION -->\n有料部分" },
    ]);
    expect(hint).toContain("旧マーカーの書き出し");
    expect(hint).not.toContain("有料部分");
  });

  it("skips siblings with an empty free part but keeps others", () => {
    const hint = formatArticleVarietyHint([
      { title: "空の記事", content: "[PAID_SECTION]\n有料部分のみ" },
      { title: "記事B", content: "書き出しあり\n[PAID_SECTION]\n有料部分" },
    ]);
    expect(hint).not.toContain("空の記事");
    expect(hint).toContain("記事B");
  });
});
