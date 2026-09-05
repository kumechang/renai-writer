// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import type { XPost } from "@prisma/client";
import { prisma } from "../db/client";
import { parseApprovalEvent, type ApprovalEvent } from "../xPoster/approval";
import { finalizeXPost } from "../xPoster/finalizePost";
import { postIssueComment, closeIssue } from "../lib/github";

// GitHub Actions (x-post-approval.yml, issue_commentイベント) から実行されるエントリポイント。
// 承認issueへのコメントを検知し、
//   - 承認/却下前の投稿への「承認」「却下」コメント → 承認ならXへ投稿、却下ならそこで終了
//   - それ以外のコメント(承認/却下キーワードを含まない自由記述、または既に投稿済み等
//     処理済みの投稿への後追いコメント) → 次回以降の生成に活かすフィードバックとして記録
// を行う。
async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is not set");
  }

  const event = parseApprovalEvent(eventPath);
  if (event.decision === "ignore") {
    console.log(`comment ignored (no matching label, or bot's own comment) issue=#${event.issueNumber}`);
    return;
  }

  const post = await prisma.xPost.findFirst({
    where: { githubIssueNumber: event.issueNumber },
  });
  if (!post) {
    console.warn(`no XPost found for issue #${event.issueNumber}`);
    return;
  }
  if (!post.githubIssueOwner || !post.githubIssueRepo) {
    throw new Error(`XPost(${post.id}) has no githubIssueOwner/githubIssueRepo (内部エラー)`);
  }
  const { githubIssueOwner: owner, githubIssueRepo: repo } = post;

  // post_failedからの再承認(投稿失敗後のリトライ)は許容するが、それ以外の
  // 承認待ち状態でない投稿への「承認」「却下」コメントは、承認/却下の判定をやり直さず
  // フィードバックとして記録する(投稿後に見て気になった点を拾えるようにするため)。
  const actionable = post.status === "pending_approval" || post.status === "post_failed";

  if (event.decision === "approve" && actionable) {
    const approved = await prisma.xPost.update({
      where: { id: post.id },
      data: { status: "approved", approvedBy: event.commenter },
    });
    await finalizeXPost(approved);
    console.log(`post approved and finalized (postId=${post.id})`);
    return;
  }

  if (event.decision === "reject" && actionable) {
    await prisma.xPost.update({
      where: { id: post.id },
      data: { status: "rejected", rejectedBy: event.commenter, rejectionReason: event.commentBody },
    });
    await postIssueComment(owner, repo, event.issueNumber, `@${event.commenter} により却下されました。`);
    await closeIssue(owner, repo, event.issueNumber);
    console.log(`post rejected (postId=${post.id})`);
    return;
  }

  await recordFeedback(post, event, owner, repo);
}

// 承認/却下のキーワードを含まない自由記述コメント、または既に処理済み(投稿済み・却下済み等)の
// 投稿へのコメントを、次回以降の生成時に参照するフィードバックとしてXPostに蓄積する。
async function recordFeedback(post: XPost, event: ApprovalEvent, owner: string, repo: string): Promise<void> {
  const entry = `[${new Date().toISOString()}] @${event.commenter}: ${event.commentBody}`;
  const notes = post.feedbackNotes ? `${post.feedbackNotes}\n---\n${entry}` : entry;

  await prisma.xPost.update({
    where: { id: post.id },
    data: { feedbackNotes: notes, feedbackBy: event.commenter, feedbackAt: new Date() },
  });
  await postIssueComment(
    owner,
    repo,
    event.issueNumber,
    "フィードバックとして記録しました。次回以降の投稿生成の参考にします。"
  );
  console.log(`feedback recorded (postId=${post.id}, issue=#${event.issueNumber})`);
}

main().catch((error) => {
  console.error("handle-x-post-approval failed", error);
  process.exitCode = 1;
});
