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
  comment: { body: string; user: { login: string }; author_association?: string };
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

  // 投稿を承認・却下できるのは、リポジトリに書き込み権限のある人だけ。無関係な人のコメントで
  // 投稿されないようにする(ワークフロー側のif条件でも同様に絞っている)。
  // ペイロードにauthor_associationが無い場合(ローカル実行など)は、そのまま通す。
  const association = payload.comment.author_association;
  if (association !== undefined && !ALLOWED_AUTHOR_ASSOCIATIONS.includes(association)) {
    return { decision: "ignore", issueNumber, commenter, commentBody };
  }

  const keyword = parseDecisionKeyword(commentBody);
  if (keyword === "承認") {
    return { decision: "approve", issueNumber, commenter, commentBody };
  }
  if (keyword === "却下") {
    return { decision: "reject", issueNumber, commenter, commentBody };
  }
  return { decision: "feedback", issueNumber, commenter, commentBody };
}

export const ALLOWED_AUTHOR_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];

// コメントの**先頭**が「承認」「却下」(とその言い切りの形)のときだけ、承認・却下として扱う。
// 以前は、本文のどこかに「承認」「却下」が含まれていれば反応していたため、承認issueを整理する
// コメント(「承認待ちの整理として〜」)が承認と判定され、古い投稿が公開されてしまった。
// 「承認待ち」「承認前に〜」のように、キーワードの後ろに別の言葉が続く場合は、フィードバック扱いにする。
// 例: 「承認」「承認します」「承認OK」「却下 トーンが強すぎる」「却下、理由は〜」
const DECISION_PATTERN = /^\s*(承認|却下)(?:します|する|です|で|お願いします|ok)?(?=$|[\s、。,.!!::\-—]|[(（])/i;

export function parseDecisionKeyword(commentBody: string): "承認" | "却下" | null {
  const match = DECISION_PATTERN.exec(commentBody);
  return match ? (match[1] as "承認" | "却下") : null;
}
