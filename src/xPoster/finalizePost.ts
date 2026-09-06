import type { XPost } from "@prisma/client";
import { prisma } from "../db/client";
import { postTweet, postReply, TweetTooLongError } from "./postTweet";
import { postIssueComment, closeIssue } from "../lib/github";
import { describeXApiError } from "./xErrorMessage";
import { loadXPosterConfig } from "./config";

// 承認済み投稿の最終処理(X投稿→DB更新→Issue通知)をまとめた共通関数。
// 手動承認フロー(handleXPostApproval.ts)からも、autoモードの即時投稿(generate.ts)からも
// 同じ関数を呼ぶことで、承認方法が違っても投稿後の扱いが一貫するようにする
// (amazon-sentaku-shiageのfinalizeApprovedPost.tsと同じ考え方)。
//
// post.replyText が設定されている場合(2ツイート構成スレッド。記事URL付きスレッド、
// または単発投稿のhook/payoff構成)は、1件目(finalText)を投稿した後、続けて
// 2件目(replyText)をその返信として投稿する。
export async function finalizeXPost(post: XPost): Promise<void> {
  const config = loadXPosterConfig();
  const issueRef =
    post.githubIssueOwner && post.githubIssueRepo && post.githubIssueNumber
      ? { owner: post.githubIssueOwner, repo: post.githubIssueRepo, number: post.githubIssueNumber }
      : null;

  let mainResult;
  try {
    mainResult = await postTweet(post.finalText, config.xCharLimit);
  } catch (error) {
    const message =
      error instanceof TweetTooLongError
        ? `文字数超過のため投稿できませんでした: ${error.message}`
        : describeXApiError(error);
    await prisma.xPost.update({ where: { id: post.id }, data: { status: "post_failed", failureReason: message } });
    if (issueRef) {
      await postIssueComment(issueRef.owner, issueRef.repo, issueRef.number, `投稿に失敗しました: ${message}`);
    }
    throw error;
  }

  if (mainResult.dryRun) {
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

  if (!post.replyText) {
    await prisma.xPost.update({
      where: { id: post.id },
      data: { status: "posted", tweetId: mainResult.tweetId, tweetUrl: mainResult.tweetUrl },
    });
    if (issueRef) {
      await postIssueComment(issueRef.owner, issueRef.repo, issueRef.number, `投稿しました: ${mainResult.tweetUrl}`);
      await closeIssue(issueRef.owner, issueRef.repo, issueRef.number);
    }
    return;
  }

  // 2ツイート構成スレッド: 1件目は投稿済み。続けて2件目(記事URL付きスレッドなら核心+記事URL、
  // 単発投稿なら回答)を返信として投稿する。
  const replyLabel = post.articleUrl ? "返信(記事URL付き)" : "返信";
  try {
    const replyResult = await postReply(post.replyText, mainResult.tweetId, config.xCharLimit);
    await prisma.xPost.update({
      where: { id: post.id },
      data: {
        status: replyResult.dryRun ? "posted_dryrun" : "posted",
        tweetId: mainResult.tweetId,
        tweetUrl: mainResult.tweetUrl,
        replyTweetId: replyResult.dryRun ? null : replyResult.tweetId,
        replyTweetUrl: replyResult.dryRun ? null : replyResult.tweetUrl,
      },
    });
    if (issueRef) {
      const message = replyResult.dryRun
        ? "ドライラン: X APIキー未設定のため実際の投稿は行っていません(DB上はposted_dryrunとして記録)。"
        : `投稿しました: ${mainResult.tweetUrl}\n${replyLabel}: ${replyResult.tweetUrl}`;
      await postIssueComment(issueRef.owner, issueRef.repo, issueRef.number, message);
      await closeIssue(issueRef.owner, issueRef.repo, issueRef.number);
    }
  } catch (error) {
    // 1件目は既に投稿済みで取り消せないため、運用者が状況を把握できるよう記録して知らせる。
    const message = `1件目は投稿できましたが、2件目(${replyLabel})の投稿に失敗しました: ${describeXApiError(error)} (1件目: ${mainResult.tweetUrl})`;
    await prisma.xPost.update({
      where: { id: post.id },
      data: { status: "post_failed", tweetId: mainResult.tweetId, tweetUrl: mainResult.tweetUrl, failureReason: message },
    });
    if (issueRef) {
      await postIssueComment(issueRef.owner, issueRef.repo, issueRef.number, message);
    }
    throw error;
  }
}
