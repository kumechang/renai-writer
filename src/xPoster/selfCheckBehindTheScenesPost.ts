import { loadPromptTemplate, renderPrompt } from "./promptLoader";
import { callClaudeJson } from "./jsonRetry";
import { buildArticleExcerpt } from "./generatePost";
import { buildTopicMaterial, type TopicMaterialInput } from "./generateBehindTheScenesPost";
import { selfCheckSchema, type SelfCheckResult } from "./selfCheckPost";

export interface SelfCheckBehindTheScenesPostInput {
  generatedPost: string;
  articleTitle: string;
  articleContent: string;
  charLimit: number;
  passThreshold: number;
  topicMaterialInput: TopicMaterialInput;
}

// パイプライン第2段階(制作裏話版): 生成された投稿を採点し、不合格(または文字数超過)なら
// 修正版も同時に作らせる。出力JSON形式は通常投稿のセルフチェック(selfCheckPost.ts)と同じ。
export async function selfCheckBehindTheScenesPost(
  model: string,
  input: SelfCheckBehindTheScenesPostInput
): Promise<{ raw: string; data: SelfCheckResult }> {
  const template = loadPromptTemplate("X投稿セルフチェック_制作裏話.md");
  const topicMaterial = buildTopicMaterial(input.topicMaterialInput);

  const prompt = renderPrompt(template, {
    generated_post: input.generatedPost,
    article_title: input.articleTitle,
    article_excerpt: buildArticleExcerpt(input.articleContent),
    topic_label: topicMaterial.label,
    topic_material: topicMaterial.material,
    char_limit: String(input.charLimit),
  });

  const result = await callClaudeJson(model, prompt, selfCheckSchema);

  // 実際の合否判定はconfig.selfCheckPassThresholdで上書きする
  // (selfCheckPost.tsと同じ考え方)。
  const pass = result.data.score >= input.passThreshold;
  return { raw: result.raw, data: { ...result.data, pass } };
}
