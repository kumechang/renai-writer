import type { DraftResponse, PlanResponse } from "../shared/types";
import { CURRENT_PAID_SECTION_MARKER, detectPaidSectionMarker } from "../shared/paidSectionMarker";

function formatPlan(plan: PlanResponse, title: string): string {
  return `- テーマ: ${plan.theme}
- 想定読者: ${plan.targetReader}
- 記事の構成:
${plan.structure}
- ボリューム: ${plan.volume}
- 有料部分の設計: ${plan.paidSection}
- タイトル: ${title}`;
}

// Claude.aiのコンソールに人間が直接コピー&ペーストして実行するためのプロンプト。
// API経由のtool useが使えないため、「JSONコードブロック1つだけを出力する」形式に統一する。
// title は企画(Plan)の推奨タイトル10個のうち、この記事(Article)に割り当てられた1つ。

export function buildWriterDraftConsolePrompt(
  plan: PlanResponse,
  title: string,
  researchBriefing?: string
): string {
  return `あなたは恋愛メディアの記事制作チームに所属する「ライター」です。
この会話でのあなたの仕事は、編集者が立てた企画をもとに記事本文を執筆することだけです。
企画の変更や採点はあなたの仕事ではありません。

# 企画内容

${formatPlan(plan, title)}
${researchBriefing ? `\n# 調査員による調査資料\n\n${researchBriefing}\n` : ""}
# 執筆の指示

- タイトルは上記のタイトルをそのまま使ってください。
- 構成（見出し）に沿って、想定読者に向けて書いてください。見出しはMarkdown記法
  （##, ### など）で書いてください。
- 有料部分の開始位置に、本文中で1回だけ次のマーカーを単独の行として挿入してください:
  \`${CURRENT_PAID_SECTION_MARKER}\`（バッククォートは含めず、マーカーの文字列そのものを1行に書く）
- ボリュームの目安（全体および無料/有料部分の文字数）に沿ってください。
- 事実やデータを書く場合は、実際に確認できる情報のみを使ってください。裏付けのない
  数値や事例をでっち上げないでください。

# 回答形式（重要）

説明や前置きの文章は書かず、下記のキーを持つJSONオブジェクトを \`\`\`json ... \`\`\` の
コードブロック1つだけで出力してください。コードブロックの外には何も書かないでください。
content は有効なJSON文字列にしてください（改行は \\n、ダブルクォート " は \\"、
バックスラッシュ \\ は \\\\ でエスケープする）。本文中で強調などに引用符を使いたい場合は、
エスケープ漏れを避けるため二重引用符 " ではなく「」や『』を使ってください。

\`\`\`json
{
  "title": "企画のタイトルと同じ文字列",
  "content": "記事本文の全文(Markdown)"
}
\`\`\``;
}

export function buildWriterRevisionConsolePrompt(
  plan: PlanResponse,
  title: string,
  previousDraft: DraftResponse,
  isFinalAttempt: boolean
): string {
  const review = previousDraft.review;
  const paidSectionMarker = detectPaidSectionMarker(previousDraft.content);

  return `あなたは恋愛メディアの記事制作チームに所属する「ライター」です。
この会話でのあなたの仕事は、編集者のレビューを踏まえて原稿を修正することだけです。
企画の変更や採点はあなたの仕事ではありません。

# 企画内容

${formatPlan(plan, title)}

# 直前の原稿（${previousDraft.revisionNumber === 0 ? "初稿" : `${previousDraft.revisionNumber}回目の修正稿`}）

タイトル: ${previousDraft.title}

\`\`\`
${previousDraft.content}
\`\`\`

# 編集者のフィードバック（${review?.score ?? "?"}点）

${review?.feedback ?? "(フィードバックがありません)"}

# 修正の指示

- フィードバックで指摘されたすべての点に対応してください。
- あえて反映しない指摘がある場合は、その理由を短く添えてください（説明文として）。
- 有料部分マーカー \`${paidSectionMarker}\` は本文中に1回だけ残してください（削除したり
  書き換えたりしないこと）。
${isFinalAttempt ? "- これが最後の修正機会です。特に重要な指摘への対応を優先してください。" : ""}

# 回答形式（重要）

説明や前置きの文章は書かず、下記のキーを持つJSONオブジェクトを \`\`\`json ... \`\`\` の
コードブロック1つだけで出力してください（差分ではなく必ず記事全体を渡してください）。
コードブロックの外には何も書かないでください。
content は有効なJSON文字列にしてください（改行は \\n、ダブルクォート " は \\"、
バックスラッシュ \\ は \\\\ でエスケープする）。本文中で強調などに引用符を使いたい場合は、
エスケープ漏れを避けるため二重引用符 " ではなく「」や『』を使ってください。

\`\`\`json
{
  "title": "企画のタイトルと同じ文字列",
  "content": "修正後の記事本文の全文(Markdown)"
}
\`\`\``;
}
