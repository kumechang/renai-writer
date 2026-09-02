import type { DraftResponse } from "../shared/types";
import type { PipelineResult } from "./run";

const STATUS_LABELS: Record<string, string> = {
  accepted: "✅ 合格（80点以上）",
  accepted_with_reservation: "⚠️ 条件付きで成立（70点超・80点未満、差し戻し上限に到達）",
  needs_human_review: "🚫 要人間確認（70点以下、差し戻し上限に到達）",
};

// 1記事の最終成果物(最終原稿)をGitHub issueコメント用のMarkdownに整形する。
export function formatArticleComment(
  draft: DraftResponse,
  result: Pick<PipelineResult, "finalScore" | "finalStatus">
): string {
  const statusLabel = STATUS_LABELS[result.finalStatus] ?? result.finalStatus;

  const lines = [
    `## ${draft.title}`,
    "",
    `**ステータス**: ${statusLabel}`,
    `**スコア**: ${result.finalScore}点 / **修正回数**: ${draft.revisionNumber}回`,
    `**文字数**: ${draft.wordCount}字`,
    "",
    "---",
    "",
    draft.content,
    "",
    "---",
  ];

  if (draft.review) {
    lines.push("", "### 編集者の最終レビュー", "", draft.review.feedback);
  }

  return lines.join("\n");
}
