import { readFileSync } from "node:fs";

export type ApprovalDecision = "approve" | "reject" | "ignore";

export interface ApprovalEvent {
  decision: ApprovalDecision;
  issueNumber: number;
  commenter: string;
  commentBody: string;
}

interface IssueCommentEventPayload {
  action: string;
  comment: { body: string; user: { login: string } };
  issue: { number: number; labels: { name: string }[] };
}

// このラベルが付いたissueだけを承認対象にする(無関係なコメントで誤反応しないためのガード。
// amazon-sentaku-shiageのparseApprovalEvent.ts / PENDING_APPROVAL_LABELと同じ考え方)。
export const PENDING_X_POST_APPROVAL_LABEL = "pending-x-post-approval";

// issue_commentイベントのペイロード(GITHUB_EVENT_PATHのJSON)から、
// 「承認」/「却下」/無視すべきコメントかを判定する。
export function parseApprovalEvent(eventPath: string): ApprovalEvent {
  const raw = readFileSync(eventPath, "utf-8");
  const payload = JSON.parse(raw) as IssueCommentEventPayload;

  const issueNumber = payload.issue.number;
  const commentBody = payload.comment.body;
  const commenter = payload.comment.user.login;

  const hasPendingLabel = payload.issue.labels.some(
    (label) => label.name === PENDING_X_POST_APPROVAL_LABEL
  );
  if (!hasPendingLabel) {
    return { decision: "ignore", issueNumber, commenter, commentBody };
  }

  if (commentBody.includes("承認")) {
    return { decision: "approve", issueNumber, commenter, commentBody };
  }
  if (commentBody.includes("却下")) {
    return { decision: "reject", issueNumber, commenter, commentBody };
  }
  return { decision: "ignore", issueNumber, commenter, commentBody };
}
