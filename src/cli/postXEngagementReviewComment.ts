// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { prisma } from "../db/client";
import { loadXEngagementConfig } from "../xEngagement/config";
import { buildReviewCommentBody } from "../xEngagement/promptIssue";
import { parseReviewCommentEvent, parseManualReviewTrigger } from "../xEngagement/reviewCommentEvent";
import { postIssueComment, listIssueComments } from "../lib/github";

// GitHub Actions (x-engagement-review.yml) から実行されるエントリポイント。
// Xリプライ検討issueに、投稿しようとしているリプライ案がコメントされたら、それをレビューする
// ためのClaude.aiプロンプトを1回だけ自動で返信する。
//
// 通常はissue_commentイベントで起動するが、コメント連投時のconcurrency競合でキャンセルされ
// レビューが返らなかった場合などのために、workflow_dispatch(issue_number指定)でも手動起動
// できるようにしている。その場合はイベントにコメント本文が含まれないため、issueの最初の
// コメント(投稿しようとしているリプライ案)をAPIから取得して使う。
async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is not set");
  }

  let issueNumber: number;
  let draftReply: string | undefined;

  if (process.env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    issueNumber = parseManualReviewTrigger(eventPath).issueNumber;
  } else {
    const event = parseReviewCommentEvent(eventPath);
    if (!event.shouldReview) {
      console.log(`comment ignored (no matching label, or bot's own comment) issue=#${event.issueNumber}`);
      return;
    }
    issueNumber = event.issueNumber;
    draftReply = event.commentBody;
  }

  const post = await prisma.watchedPost.findFirst({
    where: { githubIssueNumber: issueNumber },
    include: { watchedAccount: true },
  });
  if (!post) {
    console.warn(`no WatchedPost found for issue #${issueNumber}`);
    return;
  }
  if (post.reviewCommentPostedAt) {
    console.log(`review comment already posted once for issue #${issueNumber}, skipping`);
    return;
  }
  if (!post.githubIssueOwner || !post.githubIssueRepo) {
    throw new Error(`WatchedPost(${post.id}) has no githubIssueOwner/githubIssueRepo (内部エラー)`);
  }

  if (draftReply === undefined) {
    const comments = await listIssueComments(post.githubIssueOwner, post.githubIssueRepo, issueNumber);
    if (comments.length === 0) {
      console.warn(`issue #${issueNumber} has no comments yet, nothing to review`);
      return;
    }
    draftReply = comments[0].body;
  }

  const config = loadXEngagementConfig();
  const body = buildReviewCommentBody({
    authorUsername: post.watchedAccount.username,
    postText: post.text,
    charLimit: config.xCharLimit,
    draftReply,
  });

  await postIssueComment(post.githubIssueOwner, post.githubIssueRepo, issueNumber, body);
  await prisma.watchedPost.update({
    where: { id: post.id },
    data: { reviewCommentPostedAt: new Date() },
  });
  console.log(`posted review comment for issue #${issueNumber}`);
}

main().catch((error) => {
  console.error("post-x-engagement-review-comment failed", error);
  process.exitCode = 1;
});
