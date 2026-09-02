import { describe, expect, it } from "vitest";
import { extractJsonBlock } from "../src/agents/shared/jsonBlock";

describe("extractJsonBlock", () => {
  it("parses a ```json fenced block", () => {
    const text = 'ここに回答です。\n```json\n{"score": 85, "feedback": "良い記事です"}\n```\n以上です。';
    expect(extractJsonBlock(text)).toEqual({ score: 85, feedback: "良い記事です" });
  });

  it("parses a bare ``` fenced block without the json tag", () => {
    const text = '```\n{"title": "テスト"}\n```';
    expect(extractJsonBlock(text)).toEqual({ title: "テスト" });
  });

  it("throws a clear error when no fenced block is present", () => {
    expect(() => extractJsonBlock("コードブロックなしの回答です")).toThrow(/コードブロック/);
  });

  it("throws a clear error when the fenced block is not valid JSON", () => {
    const text = "```json\nこれはJSONではありません\n```";
    expect(() => extractJsonBlock(text)).toThrow(/JSON/);
  });

  it("picks the first fenced block when multiple are present", () => {
    const text = '```json\n{"a": 1}\n```\n\n```json\n{"a": 2}\n```';
    expect(extractJsonBlock(text)).toEqual({ a: 1 });
  });
});
