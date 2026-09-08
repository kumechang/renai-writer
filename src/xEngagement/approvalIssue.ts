import { createIssue, type CreatedIssue } from "../lib/github";
import { PENDING_ENGAGEMENT_REPLY_APPROVAL_LABEL } from "./approval";

export interface EngagementApprovalIssueContent {
  authorUsername: string;
  postText: string;
  postUrl: string;
  finalText: string;
  score: number;
  pass: boolean;
  problems: string[];
  improvements: string[];
  repoOwner: string;
  repoName: string;
}

// Issue本文を組み立てる。承認者が本文だけを見て判断できるよう、対象の投稿・リプライ案・
// スコア・指摘事項・改善点・承認方法をひとまとめにする(src/xPoster/approvalIssue.tsと同じ構成)。
export function buildEngagementIssueBody(content: EngagementApprovalIssueContent): string {
  const problems = content.problems.length > 0 ? content.problems.map((p) => `- ${p}`).join("\n") : "(なし)";
  const improvements =
    content.improvements.length > 0 ? content.improvements.map((i) => `- ${i}`).join("\n") : "(なし)";

  const lines = [
    `## リプライ対象: @${content.authorUsername}の投稿`,
    content.postUrl,
    "",
    "## 対象の投稿本文",
    "```",
    content.postText,
    "```",
    "",
    "## リプライ案",
    "```",
    content.finalText,
    "```",
    "",
    `## スコア: ${content.score} / 100 (${content.pass ? "合格" : "不合格 → 自動修正済み"})`,
    "",
    "## 指摘事項",
    problems,
    "",
    "## 改善点",
    improvements,
    "",
    "---",
    "**投稿はX APIの自動化ルール上、自動では行いません。** 承認後、この文面を" +
      "Xアプリ等から手動でリプライ投稿してください。",
    "このリプライを承認する場合はコメントで「承認」、却下する場合は「却下」と入力してください。",
    "却下する場合、「却下 もう少し落ち着いたトーンがいい」のように理由を続けて書くと記録されます。",
  ];

  return lines.join("\n");
}

export async function createEngagementApprovalIssue(
  content: EngagementApprovalIssueContent
): Promise<CreatedIssue> {
  const title = `Xリプライ承認: @${content.authorUsername}への返信`;
  const body = buildEngagementIssueBody(content);
  return createIssue(content.repoOwner, content.repoName, title, body, [
    PENDING_ENGAGEMENT_REPLY_APPROVAL_LABEL,
  ]);
}
