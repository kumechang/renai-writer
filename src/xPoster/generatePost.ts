import { loadPromptTemplate, loadConfigDoc, renderPrompt } from "./promptLoader";
import { callClaude } from "./claudeClient";
import { buildFeedbackHint } from "./feedbackHint";
import { buildVarietyHint } from "./varietyHint";
import { buildTrendHint } from "./trendWords";

// 記事本文が長いため、プロンプトに渡すのは冒頭の抜粋のみにする
// (有料部分マーカー以降はネタバレになりうるため含めない)。
const PAID_SECTION_MARKER = "[PAID_SECTION]";
// 他媒体に公開済みの記事: 同じ記事を複数回宣伝する際に毎回違う箇所に触れられるよう、
// ある程度長めに渡す(短すぎると、どの回も同じ冒頭部分しか材料が無く似た投稿になりがち
// だったため)。
const EXCERPT_LENGTH = 2000;
// まだ他媒体に公開していない記事: 内容を具体的に明かさない「匂わせ」投稿の材料として
// 渡すだけなので、冒頭のごく一部で十分(渡しすぎるとネタバレの元になる)。
const TEASER_EXCERPT_LENGTH = 300;

export function buildArticleExcerpt(content: string, maxLength: number = EXCERPT_LENGTH): string {
  const freeSection = content.split(PAID_SECTION_MARKER)[0].trim();
  const base = freeSection.length > 0 ? freeSection : content.trim();
  return base.length > maxLength ? `${base.slice(0, maxLength)}…` : base;
}

export interface GeneratePostInput {
  articleId: string;
  articleTitle: string;
  articleContent: string;
  articleUrl?: string;
  // 記事issueがクローズ済み(=他媒体に公開済み)かどうか。falseの場合は内容を具体的に
  // 明かさない「匂わせ」投稿にする(「記事issueがオープンのうちは、まだ他媒体に公開して
  // いないので匂わせ程度にしてほしい」という運用要望に対応)。
  published: boolean;
  charLimit: number;
  recentFeedbackWindow: number;
  recentPostsForVarietyWindow: number;
  trendWordsLimit: number;
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
  const varietyHint = await buildVarietyHint({ articleId: input.articleId }, input.recentPostsForVarietyWindow);
  const trendHint = await buildTrendHint(input.trendWordsLimit);

  // 未公開のうちはURLを渡されていても使わない(公開先が無いため)。
  const effectiveUrl = input.published ? input.articleUrl : undefined;
  const excerptLength = input.published ? EXCERPT_LENGTH : TEASER_EXCERPT_LENGTH;

  const publicationStatusNote = input.published
    ? "この記事は既に他媒体で公開済みです。読者を記事へ誘導するため、内容を具体的に紹介してください。"
    : "この記事はまだ他媒体で公開されていません。今回の投稿では内容の具体的な詳細・結論・" +
      "引用を一切明かさず、「今度こんなテーマで記事を書いた」という程度の匂わせに留めてください。" +
      "読者の期待感を作ることが目的で、内容を先取りして満足させてしまわないようにしてください。";

  const prompt = renderPrompt(template, {
    account_info: accountInfo,
    article_title: input.articleTitle,
    article_excerpt: buildArticleExcerpt(input.articleContent, excerptLength),
    publication_status_note: publicationStatusNote,
    article_url_section: effectiveUrl
      ? `## 記事URL\n\n${effectiveUrl}\n\nこのURLを投稿の最後に含めてください。`
      : "記事のURLはまだ決まっていません。URLは含めず、記事の内容だけで完結する投稿にしてください。",
    article_url_section_note: effectiveUrl
      ? "記事URL(そのまま貼り付け)"
      : "続きが気になる余韻で締める(URLは含めない)",
    char_limit_note: `投稿本文は全角${targetChars}文字程度を目標にし、絶対に全角${input.charLimit}文字を超えないでください。超えそうな場合は表現を削って短くしてください。`,
    feedback_hint: feedbackHint ?? "(まだ指摘はありません)",
    variety_hint: varietyHint ?? "(この記事からの投稿はまだありません)",
    trend_hint: trendHint ?? "(トレンドワードは未収集です)",
  });

  const text = await callClaude(model, prompt);
  return text.trim();
}
