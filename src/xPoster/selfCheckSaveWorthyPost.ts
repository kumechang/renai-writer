import { loadPromptTemplate, renderPrompt } from "./promptLoader";
import { callClaudeJson } from "./jsonRetry";
import { selfCheckSchema, type SelfCheckResult } from "./selfCheckPost";
import { buildBookmarkReviewSection, countBookmarkers, loadReaderPersonas } from "./bookmarkReview";
import type { SaveWorthyType } from "./generateSaveWorthyPost";

export interface SelfCheckSaveWorthyPostInput {
  generatedPost: string;
  saveType: SaveWorthyType;
  charLimit: number;
  passThreshold: number;
}

// 保存型投稿を採点する。保存されることがこの投稿の目的なので、点数に加えて
// 少なくとも1人のペルソナが保存する判定であることを合格条件にする。
export async function selfCheckSaveWorthyPost(
  model: string,
  input: SelfCheckSaveWorthyPostInput
): Promise<{ raw: string; data: SelfCheckResult }> {
  const template = loadPromptTemplate("X投稿セルフチェック_保存型.md");
  const prompt = renderPrompt(template, {
    generated_post: input.generatedPost,
    save_type_label: input.saveType.label,
    save_type_instruction: input.saveType.instruction,
    char_limit: String(Math.floor(input.charLimit / 2)),
    bookmark_review_section: buildBookmarkReviewSection(loadReaderPersonas(), true),
  });

  const result = await callClaudeJson(model, prompt, selfCheckSchema);
  const pass = isSaveWorthyPass(result.data, input.passThreshold);
  return { raw: result.raw, data: { ...result.data, pass } };
}

export function isSaveWorthyPass(data: Pick<SelfCheckResult, "score" | "bookmark_review">, passThreshold: number): boolean {
  return data.score >= passThreshold && countBookmarkers(data.bookmark_review) >= 1;
}
