import { readFileSync } from "node:fs";

// approve/reject: 承認/却下issue上で明示的なキーワードが含まれるコメント。
// feedback: それ以外の任意のコメント。承認前(却下代わりのメモ)・投稿後(投稿を見て
// 気になった点の指摘)のどちらでも、次回以降の生成に活かすフィードバックとして拾う。
export type ApprovalDecision = "approve" | "reject" | "feedback" | "ignore";

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

const BOT_LOGIN = "github-actions[bot]";

// このラベルが付いたissueだけを承認/フィードバック対象にする(無関係なコメントで
// 誤反応しないためのガード。amazon-sentaku-shiageのparseApprovalEvent.tsと同じ考え方)。
export const PENDING_X_POST_APPROVAL_LABEL = "pending-x-post-approval";

// issue_commentイベントのペイロード(GITHUB_EVENT_PATHのJSON)から、
// 「承認」/「却下」/「その他のフィードバック」/無視すべきコメントかを判定する。
export function parseApprovalEvent(eventPath: string): ApprovalEvent {
  const raw = readFileSync(eventPath, "utf-8");
  const payload = JSON.parse(raw) as IssueCommentEventPayload;

  const issueNumber = payload.issue.number;
  const commentBody = payload.comment.body;
  const commenter = payload.comment.user.login;

  const hasPendingLabel = payload.issue.labels.some(
    (label) => label.name === PENDING_X_POST_APPROVAL_LABEL
  );
  // botが自分で投稿した結果コメント(「投稿しました」「却下されました」など)への
  // 再反応(自己ループ)を防ぐ。ワークフロー側のif条件でも同様に除外しているが、
  // ローカル実行など経路が違っても安全なようコード側でも保持する。
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
