import type { XPost } from "@prisma/client";
import { prisma } from "../db/client";
import { postTweet, TweetTooLongError } from "./postTweet";
import { postIssueComment, closeIssue } from "../lib/github";
import { describeXApiError } from "./xErrorMessage";
import { loadXPosterConfig } from "./config";

// 承認済み投稿の最終処理(X投稿→DB更新→Issue通知)をまとめた共通関数。
// 手動承認フロー(handleXPostApproval.ts)からも、autoモードの即時投稿(generate.ts)からも
// 同じ関数を呼ぶことで、承認方法が違っても投稿後の扱いが一貫するようにする
// (amazon-sentaku-shiageのfinalizeApprovedPost.tsと同じ考え方)。
export async function finalizeXPost(post: XPost): Promise<void> {
  const config = loadXPosterConfig();
  const issueRef =
    post.githubIssueOwner && post.githubIssueRepo && post.githubIssueNumber
      ? { owner: post.githubIssueOwner, repo: post.githubIssueRepo, number: post.githubIssueNumber }
      : null;

  try {
    const result = await postTweet(post.finalText, config.xCharLimit);

    if (result.dryRun) {
      await prisma.xPost.update({ where: { id: post.id }, data: { status: "posted_dryrun" } });
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

    await prisma.xPost.update({
      where: { id: post.id },
      data: { status: "posted", tweetId: result.tweetId, tweetUrl: result.tweetUrl },
    });
    if (issueRef) {
      await postIssueComment(issueRef.owner, issueRef.repo, issueRef.number, `投稿しました: ${result.tweetUrl}`);
      await closeIssue(issueRef.owner, issueRef.repo, issueRef.number);
    }
  } catch (error) {
    const message =
      error instanceof TweetTooLongError
        ? `文字数超過のため投稿できませんでした: ${error.message}`
        : describeXApiError(error);
    await prisma.xPost.update({
      where: { id: post.id },
      data: { status: "post_failed", failureReason: message },
    });
    if (issueRef) {
      await postIssueComment(issueRef.owner, issueRef.repo, issueRef.number, `投稿に失敗しました: ${message}`);
    }
    throw error;
  }
}
