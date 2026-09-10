// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { prisma } from "../db/client";
import { loadXEngagementConfig } from "../xEngagement/config";
import { buildReviewCommentBody } from "../xEngagement/promptIssue";
import { parseReviewCommentEvent } from "../xEngagement/reviewCommentEvent";
import { postIssueComment } from "../lib/github";

// GitHub Actions (x-engagement-review.yml, issue_commentイベント) から実行されるエントリポイント。
// Xリプライ検討issueに、投稿しようとしているリプライ案がコメントされたら、それをレビューする
// ためのClaude.aiプロンプトを1回だけ自動で返信する。
async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is not set");
  }

  const event = parseReviewCommentEvent(eventPath);
  if (!event.shouldReview) {
    console.log(`comment ignored (no matching label, or bot's own comment) issue=#${event.issueNumber}`);
    return;
  }

  const post = await prisma.watchedPost.findFirst({
    where: { githubIssueNumber: event.issueNumber },
    include: { watchedAccount: true },
  });
  if (!post) {
    console.warn(`no WatchedPost found for issue #${event.issueNumber}`);
    return;
  }
  if (post.reviewCommentPostedAt) {
    console.log(`review comment already posted once for issue #${event.issueNumber}, skipping`);
    return;
  }
  if (!post.githubIssueOwner || !post.githubIssueRepo) {
    throw new Error(`WatchedPost(${post.id}) has no githubIssueOwner/githubIssueRepo (内部エラー)`);
  }

  const config = loadXEngagementConfig();
  const body = buildReviewCommentBody({
    authorUsername: post.watchedAccount.username,
    postText: post.text,
    charLimit: config.xCharLimit,
    draftReply: event.commentBody,
  });

  await postIssueComment(post.githubIssueOwner, post.githubIssueRepo, event.issueNumber, body);
  await prisma.watchedPost.update({
    where: { id: post.id },
    data: { reviewCommentPostedAt: new Date() },
  });
  console.log(`posted review comment for issue #${event.issueNumber}`);
}

main().catch((error) => {
  console.error("post-x-engagement-review-comment failed", error);
  process.exitCode = 1;
});
