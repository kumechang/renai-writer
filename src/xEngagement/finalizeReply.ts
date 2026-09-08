import type { EngagementReply, WatchedPost } from "@prisma/client";
import { prisma } from "../db/client";
import { postReply, TweetTooLongError } from "../xPoster/postTweet";
import { postIssueComment, closeIssue } from "../lib/github";
import { describeXApiError } from "../xPoster/xErrorMessage";
import { loadXEngagementConfig } from "./config";

// 承認済みリプライの最終処理(X投稿→DB更新→Issue通知)をまとめた共通関数。
// 手動承認フロー(handleEngagementApproval.ts)からも、autoモードの即時投稿
// (generateEngagementReplies.ts)からも同じ関数を呼ぶ(src/xPoster/finalizePost.tsと同じ構成)。
export async function finalizeEngagementReply(
  reply: EngagementReply & { watchedPost: WatchedPost }
): Promise<void> {
  const config = loadXEngagementConfig();
  const issueRef =
    reply.githubIssueOwner && reply.githubIssueRepo && reply.githubIssueNumber
      ? { owner: reply.githubIssueOwner, repo: reply.githubIssueRepo, number: reply.githubIssueNumber }
      : null;

  let result;
  try {
    result = await postReply(reply.finalText, reply.watchedPost.tweetId, config.xCharLimit);
  } catch (error) {
    const message =
      error instanceof TweetTooLongError
        ? `文字数超過のため投稿できませんでした: ${error.message}`
        : describeXApiError(error);
    await prisma.engagementReply.update({
      where: { id: reply.id },
      data: { status: "post_failed", failureReason: message },
    });
    if (issueRef) {
      await postIssueComment(issueRef.owner, issueRef.repo, issueRef.number, `投稿に失敗しました: ${message}`);
    }
    throw error;
  }

  if (result.dryRun) {
    await prisma.engagementReply.update({ where: { id: reply.id }, data: { status: "posted_dryrun" } });
    await prisma.watchedPost.update({ where: { id: reply.watchedPost.id }, data: { status: "replied" } });
    if (issueRef) {
      await postIssueComment(
        issueRef.owner,
        issueRef.repo,
        issueRef.number,
        "ドライラン: X APIキー未設定のため実際の投稿は行っていません(DB上はposted_dryrunとして記録)。"
      );
      await closeIssue(issueRef.owner, issueRef.repo, issueRef.number);
    }
    return;
  }

  await prisma.engagementReply.update({
    where: { id: reply.id },
    data: { status: "posted", tweetId: result.tweetId, tweetUrl: result.tweetUrl },
  });
  await prisma.watchedPost.update({ where: { id: reply.watchedPost.id }, data: { status: "replied" } });
  if (issueRef) {
    await postIssueComment(issueRef.owner, issueRef.repo, issueRef.number, `投稿しました: ${result.tweetUrl}`);
    await closeIssue(issueRef.owner, issueRef.repo, issueRef.number);
  }
}
