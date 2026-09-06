import { z } from "zod";
import { loadPromptTemplate, loadConfigDoc, renderPrompt } from "./promptLoader";
import { callClaudeJson } from "./jsonRetry";
import { buildFeedbackHint } from "./feedbackHint";
import { buildVarietyHint } from "./varietyHint";

export const standalonePostSchema = z.object({
  hook: z.string().min(1, "hook must not be empty"),
  payoff: z.string().min(1, "payoff must not be empty"),
});

export type StandalonePost = z.infer<typeof standalonePostSchema>;

export interface GenerateStandalonePostInput {
  charLimit: number;
  recentFeedbackWindow: number;
  recentPostsForVarietyWindow: number;
}

// 記事に紐づかない「単発投稿」(恋愛系の一般的な投稿)を、2ツイート構成(スレッド)で
// Claudeに生成させる。1件目(hook)は問題提起・あるあるで話の途中で切れる導入、
// 2件目(payoff)がその答え・気づき(1件目への返信として投稿する)。
// 自分でコメント(返信)を付けた投稿の方がインプレッションが伸びる傾向が見られたため、
// 記事URL付きスレッドと同じ2ツイート構成を単発投稿にも採用している。
// 宣伝可能な記事が無い場合のフォールバックとして、または記事宣伝だけに偏らないための
// 通常のバリエーションとして使う。
export async function generateStandalonePost(
  model: string,
  input: GenerateStandalonePostInput
): Promise<StandalonePost> {
  const accountInfo = loadConfigDoc("x_account_info.md");
  const template = loadPromptTemplate("X投稿生成_単発.md");

  const targetChars = Math.round(input.charLimit * 0.8);

  const feedbackHint = await buildFeedbackHint(input.recentFeedbackWindow);
  const varietyHint = await buildVarietyHint({ standalone: true }, input.recentPostsForVarietyWindow);

  const prompt = renderPrompt(template, {
    account_info: accountInfo,
    char_limit_note: `1件目・2件目とも、それぞれ全角${targetChars}文字程度を目標にし、絶対に全角${input.charLimit}文字を超えないでください。`,
    feedback_hint: feedbackHint ?? "(まだ指摘はありません)",
    variety_hint: varietyHint ?? "(まだ過去の単発投稿はありません)",
  });

  const { data } = await callClaudeJson(model, prompt, standalonePostSchema);
  return data;
}
