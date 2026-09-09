import { z } from "zod";
import { loadPromptTemplate, loadConfigDoc, renderPrompt } from "./promptLoader";
import { callClaudeJson } from "./jsonRetry";
import { buildArticleExcerpt } from "./generatePost";
import { buildFeedbackHint } from "./feedbackHint";
import { buildVarietyHint } from "./varietyHint";
import { buildTrendHint } from "./trendWords";

export const urlThreadPostSchema = z.object({
  hook: z.string().min(1, "hook must not be empty"),
  payoff: z.string().min(1, "payoff must not be empty"),
});

export type UrlThreadPost = z.infer<typeof urlThreadPostSchema>;

export interface GenerateUrlThreadPostInput {
  articleId: string;
  articleTitle: string;
  articleContent: string;
  charLimit: number;
  recentFeedbackWindow: number;
  recentPostsForVarietyWindow: number;
  trendWordsLimit: number;
}

// 公開済み記事を、記事URL付きの2ツイート構成(スレッド)で紹介する投稿を生成する。
// 1件目(hook)は話の途中で切れる導入、2件目(payoff)がその続き(核心)。
// 記事URL自体はここでは生成せず、投稿時にpayoffへ別途付与する。
export async function generateUrlThreadPost(
  model: string,
  input: GenerateUrlThreadPostInput
): Promise<UrlThreadPost> {
  const accountInfo = loadConfigDoc("x_account_info.md");
  const template = loadPromptTemplate("X投稿生成_URL付き.md");
  const targetChars = Math.round(input.charLimit * 0.8);

  const feedbackHint = await buildFeedbackHint(input.recentFeedbackWindow);
  const varietyHint = await buildVarietyHint({ articleId: input.articleId }, input.recentPostsForVarietyWindow);
  const trendHint = await buildTrendHint(input.trendWordsLimit);

  const prompt = renderPrompt(template, {
    account_info: accountInfo,
    article_title: input.articleTitle,
    article_excerpt: buildArticleExcerpt(input.articleContent),
    char_limit_note:
      `1件目・2件目とも、それぞれ全角${targetChars}文字程度を目標にし、絶対に全角` +
      `${input.charLimit}文字を超えないでください(2件目は記事URL追加分の余白を残してください)。`,
    feedback_hint: feedbackHint ?? "(まだ指摘はありません)",
    variety_hint: varietyHint ?? "(この記事からの投稿はまだありません)",
    trend_hint: trendHint ?? "(トレンドワードは未収集です)",
  });

  const { data } = await callClaudeJson(model, prompt, urlThreadPostSchema);
  return data;
}
