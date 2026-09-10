import { readFileSync } from "node:fs";
import { X_ENGAGEMENT_PROMPT_LABEL } from "./promptIssue";

const BOT_LOGIN = "github-actions[bot]";

export interface ReviewCommentEvent {
  issueNumber: number;
  commenter: string;
  commentBody: string;
  // x-engagement-reply-promptラベルが付いたissueへの、bot以外からのコメントかどうか。
  // falseの場合は無関係なissueへのコメント、またはbotの自己コメント(自己ループ防止)。
  shouldReview: boolean;
}

interface IssueCommentEventPayload {
  comment: { body: string; user: { login: string } };
  issue: { number: number; labels: { name: string }[] };
}

// issue_commentイベントのペイロード(GITHUB_EVENT_PATHのJSON)から、Xリプライ検討issueへの
// コメントに対してレビュー用プロンプトを返すべきかどうかを判定する。「レビューは1回だけ」の
// ガード(2回目以降のコメントに反応しない)はWatchedPost.reviewCommentPostedAt側で行うため、
// ここではイベント自体が対象issue・対象コメントかどうかだけを見る。
export function parseReviewCommentEvent(eventPath: string): ReviewCommentEvent {
  const raw = readFileSync(eventPath, "utf-8");
  const payload = JSON.parse(raw) as IssueCommentEventPayload;

  const issueNumber = payload.issue.number;
  const commenter = payload.comment.user.login;
  const commentBody = payload.comment.body;

  const hasLabel = payload.issue.labels.some((label) => label.name === X_ENGAGEMENT_PROMPT_LABEL);

  return {
    issueNumber,
    commenter,
    commentBody,
    shouldReview: hasLabel && commenter !== BOT_LOGIN,
  };
}
