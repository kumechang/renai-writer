import { z } from "zod";
import { loadPromptTemplate, renderPrompt } from "../xPoster/promptLoader";
import { callClaudeJson } from "../xPoster/jsonRetry";

// final_replyのmin(1)は、通常のセルフチェックで実際に発生した「合格時は空でよいと
// モデルが誤解する」不具合の再発防止と同じ考え方(selfCheckStandalonePost.tsを参照)。
export const engagementReplySelfCheckSchema = z.object({
  score: z.number(),
  pass: z.boolean(),
  problems: z.array(z.string()),
  improvements: z.array(z.string()),
  final_reply: z.string().min(1, "final_reply must not be empty"),
});

export type EngagementReplySelfCheckResult = z.infer<typeof engagementReplySelfCheckSchema>;

export interface SelfCheckReplyInput {
  authorUsername: string;
  postText: string;
  reply: string;
  charLimit: number;
  passThreshold: number;
}

// 生成したリプライ案を採点し、不合格(または文字数超過)なら修正版も同時に作らせる
// (selfCheckStandalonePost.tsと同じ構成)。
export async function selfCheckReply(
  model: string,
  input: SelfCheckReplyInput
): Promise<{ raw: string; data: EngagementReplySelfCheckResult }> {
  const template = loadPromptTemplate("Xエンゲージメントリプライセルフチェック.md");
  const prompt = renderPrompt(template, {
    author_username: input.authorUsername,
    post_text: input.postText,
    reply: input.reply,
    char_limit: String(input.charLimit),
  });

  const result = await callClaudeJson(model, prompt, engagementReplySelfCheckSchema);
  const pass = result.data.score >= input.passThreshold;
  return { raw: result.raw, data: { ...result.data, pass } };
}
