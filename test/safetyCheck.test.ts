import { beforeEach, describe, expect, it, vi } from "vitest";
import { callClaude } from "../src/xPoster/claudeClient";
import { applySafetyGate, buildSafetyCheckSection } from "../src/xPoster/safetyCheck";
import { selfCheckPost } from "../src/xPoster/selfCheckPost";
import { selfCheckStandalonePost } from "../src/xPoster/selfCheckStandalonePost";
import { selfCheckUrlThreadPost } from "../src/xPoster/selfCheckUrlThreadPost";
import { selfCheckBehindTheScenesPost } from "../src/xPoster/selfCheckBehindTheScenesPost";
import { selfCheckSaveWorthyPost } from "../src/xPoster/selfCheckSaveWorthyPost";
import { SAVE_WORTHY_TYPES } from "../src/xPoster/generateSaveWorthyPost";

vi.mock("../src/xPoster/claudeClient", () => ({ callClaude: vi.fn() }));

describe("applySafetyGate", () => {
  const base = { score: 95, pass: true, problems: ["既存の指摘"] };

  it("leaves a passing result untouched when there are no violations", () => {
    expect(applySafetyGate({ ...base, safety_violations: [] })).toEqual({ ...base, safety_violations: [] });
  });

  it("fails a high-scoring result and lists each violation first in problems", () => {
    const gated = applySafetyGate({ ...base, safety_violations: ["鍵垢を探す行動を当たり前に扱っている"] });
    expect(gated.pass).toBe(false);
    expect(gated.problems).toEqual(["[安全] 鍵垢を探す行動を当たり前に扱っている", "既存の指摘"]);
  });

  it("ignores blank entries the model may emit", () => {
    const gated = applySafetyGate({ ...base, safety_violations: ["", "  "] });
    expect(gated.pass).toBe(true);
    expect(gated.safety_violations).toEqual([]);
  });
});

describe("buildSafetyCheckSection", () => {
  it("covers the topics that must never be auto-posted", () => {
    const section = buildSafetyCheckSection();
    for (const keyword of ["希死念慮", "つきまとい", "まだ終わっていない", "3ヶ月", "研究もある", "safety_violations"]) {
      expect(section).toContain(keyword);
    }
  });
});

describe("self-checks enforce the safety gate", () => {
  beforeEach(() => {
    vi.mocked(callClaude).mockReset();
  });

  it("fails every post kind when the model reports a violation, regardless of score", async () => {
    vi.mocked(callClaude).mockResolvedValue(
      JSON.stringify({
        score: 98,
        pass: true,
        problems: [],
        improvements: [],
        final_post: "本文",
        final_hook: "1件目",
        final_payoff: "2件目",
        safety_violations: ["回復の期限を示している"],
        bookmark_review: [{ persona: "美咲", would_bookmark: true, reason: "使える" }],
      })
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
      selfCheckSaveWorthyPost("m", { ...common, generatedPost: "本文", saveType: SAVE_WORTHY_TYPES[0] }),
    ]);

    for (const { data } of results) {
      expect(data.pass).toBe(false);
      expect(data.problems[0]).toBe("[安全] 回復の期限を示している");
    }
    for (const [, prompt] of vi.mocked(callClaude).mock.calls) {
      expect(prompt).toContain("安全チェック");
    }
  });
});
