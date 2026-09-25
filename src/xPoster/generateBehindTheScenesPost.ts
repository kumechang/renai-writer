import { loadPromptTemplate, loadConfigDoc, renderPrompt } from "./promptLoader";
import { callClaude } from "./claudeClient";
import { buildFeedbackHint } from "./feedbackHint";
import { buildRecentOpeningsHint, buildVarietyHint } from "./varietyHint";
import { buildArticleExcerpt } from "./generatePost";
import type { BehindTheScenesTopic } from "./selectBehindTheScenesTarget";

// タイトル案を並べる際の最大件数(Plan.titleCandidatesは50件あるが、対比材料としては
// 数件で十分で、渡しすぎるとプロンプトが冗長になるため絞る)。
const OTHER_TITLE_CANDIDATES_LIMIT = 5;

export interface TopicMaterialInput {
  topic: BehindTheScenesTopic;
  articleTitle: string;
  planTheme: string;
  planTargetReader: string;
  // JSON文字列(Plan.titleCandidates)。topic="title"の場合のみ使う。
  planTitleCandidatesJson: string;
  // Plan.structure。topic="structure"の場合のみ使う。
  planStructure: string;
}

export interface TopicMaterial {
  label: string;
  material: string;
  question: string;
}

function pickRandomOthers(candidates: string[], exclude: string, limit: number): string[] {
  const others = candidates.filter((c) => c !== exclude);
  const shuffled = [...others].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, limit);
}

// トピック(テーマ/タイトル/構成)ごとに、プロンプトへ渡す材料と問いかけを組み立てる。
export function buildTopicMaterial(input: TopicMaterialInput): TopicMaterial {
  switch (input.topic) {
    case "theme": {
      return {
        label: "なぜこのテーマを選んだのか",
        material:
          `このテーマを選んだ狙い:\n\n${input.planTheme}\n\n` + `想定読者:\n\n${input.planTargetReader}`,
        question: "なぜこのテーマで書こうと思ったのか、読者に率直に共有してください。",
      };
    }
    case "title": {
      const allCandidates = JSON.parse(input.planTitleCandidatesJson) as string[];
      const otherTitles = pickRandomOthers(allCandidates, input.articleTitle, OTHER_TITLE_CANDIDATES_LIMIT);
      const otherTitlesBlock =
        otherTitles.length > 0
          ? otherTitles.map((t) => `- ${t}`).join("\n")
          : "(他の案は特にありません)";
      return {
        label: "なぜこのタイトルにしたのか",
        material:
          `実際に使ったタイトル:\n\n${input.articleTitle}\n\n` +
          `検討した他のタイトル案(一部):\n\n${otherTitlesBlock}`,
        question: "数あるタイトル案の中から、なぜこのタイトルを選んだのか、決め手になった考えを共有してください。",
      };
    }
    case "structure": {
      return {
        label: "どういう構成にしたのか",
        material: `実際の構成:\n\n${input.planStructure}`,
        question: "この構成にした狙い・工夫した点を共有してください。",
      };
    }
  }
}

export interface GenerateBehindTheScenesPostInput {
  articleId: string;
  articleTitle: string;
  articleContent: string;
  topic: BehindTheScenesTopic;
  planTheme: string;
  planTargetReader: string;
  planTitleCandidatesJson: string;
  planStructure: string;
  charLimit: number;
  recentFeedbackWindow: number;
  recentPostsForVarietyWindow: number;
  recentOpeningsWindow: number;
}

// パイプライン第1段階(制作裏話版): 公開済み記事の「なぜこのテーマ/タイトル/構成にしたか」を
// 振り返るX投稿の本文をClaudeに生成させる。出力はプレーンテキストのみ。
export async function generateBehindTheScenesPost(
  model: string,
  input: GenerateBehindTheScenesPostInput
): Promise<string> {
  const accountInfo = loadConfigDoc("x_account_info.md");
  const template = loadPromptTemplate("X投稿生成_制作裏話.md");

  const targetChars = Math.round(input.charLimit * 0.8);

  const feedbackHint = await buildFeedbackHint(input.recentFeedbackWindow);
  const varietyHint = await buildVarietyHint({ articleId: input.articleId }, input.recentPostsForVarietyWindow);
  const recentOpeningsHint = await buildRecentOpeningsHint(input.recentOpeningsWindow);

  const topicMaterial = buildTopicMaterial({
    topic: input.topic,
    articleTitle: input.articleTitle,
    planTheme: input.planTheme,
    planTargetReader: input.planTargetReader,
    planTitleCandidatesJson: input.planTitleCandidatesJson,
    planStructure: input.planStructure,
  });

  const prompt = renderPrompt(template, {
    account_info: accountInfo,
    article_title: input.articleTitle,
    article_excerpt: buildArticleExcerpt(input.articleContent),
    topic_label: topicMaterial.label,
    topic_material: topicMaterial.material,
    topic_question: topicMaterial.question,
    char_limit_note: `投稿本文は全角${targetChars}文字程度を目標にし、絶対に全角${input.charLimit}文字を超えないでください。超えそうな場合は表現を削って短くしてください。`,
    feedback_hint: feedbackHint ?? "(まだ指摘はありません)",
    variety_hint: varietyHint ?? "(この記事からの投稿はまだありません)",
    recent_openings_hint: recentOpeningsHint ?? "(まだ投稿はありません)",
  });

  const text = await callClaude(model, prompt);
  return text.trim();
}
