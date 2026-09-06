import { z } from "zod";
import { loadPromptTemplate, renderPrompt } from "./promptLoader";
import { callClaudeJson } from "./jsonRetry";
import { buildArticleExcerpt } from "./generatePost";

// final_hook/final_payoffのmin(1)は、通常のセルフチェックで実際に発生した
// 「合格時はfinal_postが空でよいとモデルが誤解する」不具合の再発防止と同じ考え方。
export const urlThreadSelfCheckSchema = z.object({
  score: z.number(),
  pass: z.boolean(),
  problems: z.array(z.string()),
  improvements: z.array(z.string()),
  final_hook: z.string().min(1, "final_hook must not be empty"),
  final_payoff: z.string().min(1, "final_payoff must not be empty"),
});

export type UrlThreadSelfCheckResult = z.infer<typeof urlThreadSelfCheckSchema>;

export interface SelfCheckUrlThreadPostInput {
  hook: string;
  payoff: string;
  articleTitle: string;
  articleContent: string;
  articleUrl: string;
  charLimit: number;
  passThreshold: number;
}

// 記事URL付き2ツイート投稿(hook/payoff)を採点し、不合格(または文字数超過)なら
// 修正版も同時に作らせる。
export async function selfCheckUrlThreadPost(
  model: string,
  input: SelfCheckUrlThreadPostInput
): Promise<{ raw: string; data: UrlThreadSelfCheckResult }> {
  const template = loadPromptTemplate("X投稿セルフチェック_URL付き.md");
  const prompt = renderPrompt(template, {
    hook: input.hook,
    payoff: input.payoff,
    article_title: input.articleTitle,
    article_excerpt: buildArticleExcerpt(input.articleContent),
    article_url: input.articleUrl,
    char_limit: String(input.charLimit),
  });

  const result = await callClaudeJson(model, prompt, urlThreadSelfCheckSchema);
  const pass = result.data.score >= input.passThreshold;
  return { raw: result.raw, data: { ...result.data, pass } };
}
