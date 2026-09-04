import { z } from "zod";
import { loadPromptTemplate, renderPrompt } from "./promptLoader";
import { callClaudeJson } from "./jsonRetry";
import { buildArticleExcerpt } from "./generatePost";

// X投稿セルフチェック.md の出力JSON形式。合否に関わらずfinal_postには
// (不合格なら修正済みの)最終候補本文が入る想定。
// min(1)は、合格時に「修正不要なので空でよい」とモデルが誤解し、final_postが
// 空文字のまま返ってきた不具合の再発防止(実運用で1度発生を確認済み)。
// 空ならバリデーションエラーとしてcallClaudeJsonの1回だけの再試行を発生させる。
export const selfCheckSchema = z.object({
  score: z.number(),
  pass: z.boolean(),
  problems: z.array(z.string()),
  improvements: z.array(z.string()),
  final_post: z.string().min(1, "final_post must not be empty"),
});

export type SelfCheckResult = z.infer<typeof selfCheckSchema>;

export interface SelfCheckPostInput {
  generatedPost: string;
  articleTitle: string;
  articleContent: string;
  charLimit: number;
  passThreshold: number;
}

// パイプライン第2段階: 生成された投稿を採点し、不合格(または文字数超過)なら修正版も同時に作らせる。
export async function selfCheckPost(
  model: string,
  input: SelfCheckPostInput
): Promise<{ raw: string; data: SelfCheckResult }> {
  const template = loadPromptTemplate("X投稿セルフチェック.md");
  const prompt = renderPrompt(template, {
    generated_post: input.generatedPost,
    article_title: input.articleTitle,
    article_excerpt: buildArticleExcerpt(input.articleContent),
    char_limit: String(input.charLimit),
  });

  const result = await callClaudeJson(model, prompt, selfCheckSchema);

  // プロンプト本文には合格基準(80点)が直書きされているが、運用しながら調整したい値のため、
  // 実際の合否判定はconfig.selfCheckPassThresholdで上書きする
  // (amazon-sentaku-shiageのselfCheckStage.tsと同じ考え方)。
  const pass = result.data.score >= input.passThreshold;
  return { raw: result.raw, data: { ...result.data, pass } };
}
