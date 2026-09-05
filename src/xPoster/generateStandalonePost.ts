import { loadPromptTemplate, loadConfigDoc, renderPrompt } from "./promptLoader";
import { callClaude } from "./claudeClient";
import { buildFeedbackHint } from "./feedbackHint";
import { buildVarietyHint } from "./varietyHint";

export interface GenerateStandalonePostInput {
  charLimit: number;
  recentFeedbackWindow: number;
  recentPostsForVarietyWindow: number;
}

// 記事に紐づかない「単発投稿」(恋愛系の一般的な投稿)をClaudeに生成させる。
// 宣伝可能な記事が無い場合のフォールバックとして、または記事宣伝だけに偏らないための
// 通常のバリエーションとして使う。出力はプレーンテキストのみ。
export async function generateStandalonePost(model: string, input: GenerateStandalonePostInput): Promise<string> {
  const accountInfo = loadConfigDoc("x_account_info.md");
  const template = loadPromptTemplate("X投稿生成_単発.md");

  const targetChars = Math.round(input.charLimit * 0.8);

  const feedbackHint = await buildFeedbackHint(input.recentFeedbackWindow);
  const varietyHint = await buildVarietyHint({ standalone: true }, input.recentPostsForVarietyWindow);

  const prompt = renderPrompt(template, {
    account_info: accountInfo,
    char_limit_note: `投稿本文は全角${targetChars}文字程度を目標にし、絶対に全角${input.charLimit}文字を超えないでください。超えそうな場合は表現を削って短くしてください。`,
    feedback_hint: feedbackHint ?? "(まだ指摘はありません)",
    variety_hint: varietyHint ?? "(まだ過去の単発投稿はありません)",
  });

  const text = await callClaude(model, prompt);
  return text.trim();
}
