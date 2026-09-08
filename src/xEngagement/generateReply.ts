import { loadPromptTemplate, loadConfigDoc, renderPrompt } from "../xPoster/promptLoader";
import { callClaude } from "../xPoster/claudeClient";
import { buildEngagementFeedbackHint } from "./feedbackHint";

export interface GenerateReplyInput {
  authorUsername: string;
  postText: string;
  charLimit: number;
  recentFeedbackWindow: number;
}

// ウォッチ対象アカウントの投稿1件に対する、心のこもった(かつ有益な)リプライ本文を
// Claudeに生成させる。X投稿の生成(generatePost.ts等)と同じくアカウントペルソナ
// (config/x_account_info.md)をそのまま使う(「自分の言葉で」書くリプライのため)。
export async function generateReply(model: string, input: GenerateReplyInput): Promise<string> {
  const accountInfo = loadConfigDoc("x_account_info.md");
  const template = loadPromptTemplate("Xエンゲージメントリプライ生成.md");

  const feedbackHint = await buildEngagementFeedbackHint(input.recentFeedbackWindow);

  const prompt = renderPrompt(template, {
    account_info: accountInfo,
    author_username: input.authorUsername,
    post_text: input.postText,
    feedback_hint: feedbackHint ?? "(まだ指摘はありません)",
    char_limit: String(input.charLimit),
  });

  const result = await callClaude(model, prompt);
  return result.trim();
}
