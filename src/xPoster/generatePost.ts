import { loadPromptTemplate, loadConfigDoc, renderPrompt } from "./promptLoader";
import { callClaude } from "./claudeClient";
import { buildFeedbackHint } from "./feedbackHint";

// 記事本文が長いため、プロンプトに渡すのは冒頭の抜粋のみにする
// (有料部分マーカー以降はネタバレになりうるため含めない)。
const PAID_SECTION_MARKER = "[PAID_SECTION]";
const EXCERPT_LENGTH = 800;

export function buildArticleExcerpt(content: string): string {
  const freeSection = content.split(PAID_SECTION_MARKER)[0].trim();
  const base = freeSection.length > 0 ? freeSection : content.trim();
  return base.length > EXCERPT_LENGTH ? `${base.slice(0, EXCERPT_LENGTH)}…` : base;
}

export interface GeneratePostInput {
  articleTitle: string;
  articleContent: string;
  articleUrl?: string;
  charLimit: number;
  recentFeedbackWindow: number;
}

// パイプライン第1段階: 記事を紹介するX投稿の本文をClaudeに生成させる。
// 出力はプレーンテキストのみ(X投稿生成.md の「出力」指示に従う)。
export async function generatePost(model: string, input: GeneratePostInput): Promise<string> {
  const accountInfo = loadConfigDoc("x_account_info.md");
  const template = loadPromptTemplate("X投稿生成.md");

  // 実際の上限ぴったりを目安として伝えると超過しがちなため、8割程度を目標値として
  // 提示しつつ上限も明記し、狙いより短めに収まりやすくする
  // (amazon-sentaku-shiageのgenerateStage.tsと同じ考え方)。
  const targetChars = Math.round(input.charLimit * 0.8);

  const feedbackHint = await buildFeedbackHint(input.recentFeedbackWindow);

  const prompt = renderPrompt(template, {
    account_info: accountInfo,
    article_title: input.articleTitle,
    article_excerpt: buildArticleExcerpt(input.articleContent),
    article_url_section: input.articleUrl
      ? `## 記事URL\n\n${input.articleUrl}\n\nこのURLを投稿の最後に含めてください。`
      : "記事のURLはまだ決まっていません。URLは含めず、記事の内容だけで完結する投稿にしてください。",
    article_url_section_note: input.articleUrl
      ? "記事URL(そのまま貼り付け)"
      : "続きが気になる余韻で締める(URLは含めない)",
    char_limit_note: `投稿本文は全角${targetChars}文字程度を目標にし、絶対に全角${input.charLimit}文字を超えないでください。超えそうな場合は表現を削って短くしてください。`,
    feedback_hint: feedbackHint ?? "(まだ指摘はありません)",
  });

  const text = await callClaude(model, prompt);
  return text.trim();
}
