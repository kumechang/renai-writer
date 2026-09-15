import { createIssue, type CreatedIssue } from "../lib/github";
import { buildReplyConsolePrompt, buildReplyReviewPrompt } from "./replyConsolePrompt";

export const X_ENGAGEMENT_PROMPT_LABEL = "x-engagement-reply-prompt";

// プロンプト自体が投稿本文を```で囲んでいるため、issue本文側でも```で囲むと
// 内側の```がそこでコードブロックを閉じてしまい、GitHub上でプロンプトが途中で
// 分割されて表示され、1回でコピーできなくなる。内側(3個)より長いフェンスを
// 使うことで、内側の```を素通りさせて外側だけを閉じるようにする(コメントで運用者が
// 貼るリプライ案にも```が含まれる可能性があるため、レビュー用コメントでも同じ理由で使う)。
const ISSUE_CODE_FENCE = "````";

export interface ReplyPromptIssueContent {
  postText: string;
  postUrl: string;
  // 投稿のインプレッション数(閲覧数)。ユーザー名は解決しない(コスト削減のため)ので、
  // 誰の投稿かはissue上のリンクを開いて直接確認してもらう。
  impressionCount: number;
  charLimit: number;
}

// issue本文を組み立てる。対象の投稿とClaude.aiに貼り付けるプロンプトをひとまとめにし、
// 運用者がこのissueだけを見てリプライを検討・投稿できるようにする。
// 案の作成とセルフチェックを1つのプロンプトに統合しているため、コピー&ペーストは1回で済む。
export function buildReplyPromptIssueBody(content: ReplyPromptIssueContent): string {
  const prompt = buildReplyConsolePrompt({
    postText: content.postText,
    charLimit: content.charLimit,
  });

  return [
    `## リプライ対象の投稿(${content.impressionCount.toLocaleString()}インプレッション)`,
    content.postUrl,
    "",
    "(誰の投稿かは、上のリンクを開いて確認してください。ユーザー名の取得はコスト削減のため" +
      "行っていません)",
    "",
    "## 対象の投稿本文",
    "```",
    content.postText,
    "```",
    "",
    "## Claude.aiのチャットに貼り付けるプロンプト",
    "",
    "以下をコピーして [Claude.ai](https://claude.ai) のチャット画面に貼り付けてください" +
      "(Claude APIは呼ばないため、料金は発生しません)。",
    "",
    ISSUE_CODE_FENCE,
    prompt,
    ISSUE_CODE_FENCE,
    "",
    "---",
    "返信文が決まったら、Xアプリ等から手動でリプライを投稿し、このissueをクローズしてください。",
    "**投稿前に、Claude.aiのチャットから返信文だけを正しくコピーできているか" +
      "(claude.aiの共有リンクなどが誤って混ざっていないか)を必ず確認してください。**",
    "「今回は良いリプライ案が思いつきません」という返答だった場合は、リプライを見送って" +
      "このissueをクローズしてください。",
  ].join("\n");
}

export interface ReviewCommentBodyContent {
  postText: string;
  charLimit: number;
  // issueにコメントされた、投稿しようとしているリプライ案そのもの。
  draftReply: string;
}

// リプライ検討issueへの最初のコメント(投稿しようとしているリプライ案)への返信として、
// それをレビューするためのClaude.aiプロンプトを1回だけ自動で返す
// (src/cli/postXEngagementReviewComment.ts、WatchedPost.reviewCommentPostedAtで
// 「1回だけ」を保証する)。
export function buildReviewCommentBody(content: ReviewCommentBodyContent): string {
  const prompt = buildReplyReviewPrompt(content);

  return [
    "投稿しようとしているリプライ案のレビュー用プロンプトです。",
    "以下をコピーして [Claude.ai](https://claude.ai) のチャット画面に貼り付けてください" +
      "(Claude APIは呼ばないため、料金は発生しません)。",
    "",
    ISSUE_CODE_FENCE,
    prompt,
    ISSUE_CODE_FENCE,
  ].join("\n");
}

export async function createReplyPromptIssue(
  owner: string,
  repo: string,
  content: ReplyPromptIssueContent
): Promise<CreatedIssue> {
  const title = `Xリプライ検討: ${content.impressionCount.toLocaleString()}インプレッションの投稿`;
  const body = buildReplyPromptIssueBody(content);
  return createIssue(owner, repo, title, body, [X_ENGAGEMENT_PROMPT_LABEL]);
}
