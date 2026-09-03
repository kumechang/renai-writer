// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { prisma } from "../db/client";
import { parseApprovalEvent } from "../xPoster/approval";
import { finalizeXPost } from "../xPoster/finalizePost";
import { postIssueComment, closeIssue } from "../lib/github";

// GitHub Actions (x-post-approval.yml, issue_commentイベント) から実行されるエントリポイント。
// 承認issueへの「承認」/「却下」コメントを検知し、承認ならXへ投稿する。
async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is not set");
  }

  const event = parseApprovalEvent(eventPath);
  if (event.decision === "ignore") {
    console.log(`comment ignored (no matching label or keyword) issue=#${event.issueNumber}`);
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

  // post_failedからの再承認(投稿失敗後のリトライ)は許容するが、
  // 既にapproved/rejected/postedになっている投稿への二重コメントはno-opにする。
  const actionable = post.status === "pending_approval" || post.status === "post_failed";
  if (!actionable) {
    if (event.decision === "reject" && post.status === "rejected") {
      await prisma.xPost.update({
        where: { id: post.id },
        data: { rejectedBy: event.commenter, rejectionReason: event.commentBody },
      });
      await postIssueComment(owner, repo, event.issueNumber, "却下理由を記録しました。");
      console.log(`rejection reason updated (postId=${post.id})`);
      return;
    }

    await postIssueComment(owner, repo, event.issueNumber, `この投稿は既に処理済みです(状態: ${post.status})。`);
    console.log(`post already processed, no-op (issue=#${event.issueNumber}, status=${post.status})`);
    return;
  }

  if (event.decision === "reject") {
    await prisma.xPost.update({
      where: { id: post.id },
      data: { status: "rejected", rejectedBy: event.commenter, rejectionReason: event.commentBody },
    });
    await postIssueComment(owner, repo, event.issueNumber, `@${event.commenter} により却下されました。`);
    await closeIssue(owner, repo, event.issueNumber);
    console.log(`post rejected (postId=${post.id})`);
    return;
  }

  const approved = await prisma.xPost.update({
    where: { id: post.id },
    data: { status: "approved", approvedBy: event.commenter },
  });
  await finalizeXPost(approved);
  console.log(`post approved and finalized (postId=${post.id})`);
}

main().catch((error) => {
  console.error("handle-x-post-approval failed", error);
  process.exitCode = 1;
});
