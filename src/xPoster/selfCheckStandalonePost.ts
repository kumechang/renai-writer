import { z } from "zod";
import { loadPromptTemplate, renderPrompt } from "./promptLoader";
import { callClaudeJson } from "./jsonRetry";

// final_hook/final_payoffのmin(1)は、通常のセルフチェックで実際に発生した
// 「合格時はfinal_postが空でよいとモデルが誤解する」不具合の再発防止と同じ考え方。
export const standaloneSelfCheckSchema = z.object({
  score: z.number(),
  pass: z.boolean(),
  problems: z.array(z.string()),
  improvements: z.array(z.string()),
  final_hook: z.string().min(1, "final_hook must not be empty"),
  final_payoff: z.string().min(1, "final_payoff must not be empty"),
});

export type StandaloneSelfCheckResult = z.infer<typeof standaloneSelfCheckSchema>;

export interface SelfCheckStandalonePostInput {
  hook: string;
  payoff: string;
  charLimit: number;
  passThreshold: number;
}

// 記事に紐づかない単発投稿(hook/payoffの2ツイート構成)を採点し、不合格
// (または文字数超過)なら修正版も同時に作らせる。
export async function selfCheckStandalonePost(
  model: string,
  input: SelfCheckStandalonePostInput
): Promise<{ raw: string; data: StandaloneSelfCheckResult }> {
  const template = loadPromptTemplate("X投稿セルフチェック_単発.md");
  const prompt = renderPrompt(template, {
    hook: input.hook,
    payoff: input.payoff,
    char_limit: String(input.charLimit),
  });

  const result = await callClaudeJson(model, prompt, standaloneSelfCheckSchema);
  const pass = result.data.score >= input.passThreshold;
  return { raw: result.raw, data: { ...result.data, pass } };
}
