import { readFileSync } from "node:fs";

// approve/reject: 承認/却下issue上で明示的なキーワードが含まれるコメント。
// feedback: それ以外の任意のコメント。承認前(却下代わりのメモ)・投稿後(投稿を見て
// 気になった点の指摘)のどちらでも、次回以降の生成に活かすフィードバックとして拾う。
// (src/xPoster/approval.tsと同じ構成)
export type EngagementApprovalDecision = "approve" | "reject" | "feedback" | "ignore";

export interface EngagementApprovalEvent {
  decision: EngagementApprovalDecision;
  issueNumber: number;
  commenter: string;
  commentBody: string;
}

interface IssueCommentEventPayload {
  action: string;
  comment: { body: string; user: { login: string } };
  issue: { number: number; labels: { name: string }[] };
}

const BOT_LOGIN = "github-actions[bot]";

// このラベルが付いたissueだけを承認/フィードバック対象にする(無関係なコメントで
// 誤反応しないためのガード)。
export const PENDING_ENGAGEMENT_REPLY_APPROVAL_LABEL = "pending-x-engagement-approval";

// issue_commentイベントのペイロード(GITHUB_EVENT_PATHのJSON)から、
// 「承認」/「却下」/「その他のフィードバック」/無視すべきコメントかを判定する。
export function parseEngagementApprovalEvent(eventPath: string): EngagementApprovalEvent {
  const raw = readFileSync(eventPath, "utf-8");
  const payload = JSON.parse(raw) as IssueCommentEventPayload;

  const issueNumber = payload.issue.number;
  const commentBody = payload.comment.body;
  const commenter = payload.comment.user.login;

  const hasPendingLabel = payload.issue.labels.some(
    (label) => label.name === PENDING_ENGAGEMENT_REPLY_APPROVAL_LABEL
  );
  if (!hasPendingLabel || commenter === BOT_LOGIN) {
    return { decision: "ignore", issueNumber, commenter, commentBody };
  }

  if (commentBody.includes("承認")) {
    return { decision: "approve", issueNumber, commenter, commentBody };
  }
  if (commentBody.includes("却下")) {
    return { decision: "reject", issueNumber, commenter, commentBody };
  }
  return { decision: "feedback", issueNumber, commenter, commentBody };
}
