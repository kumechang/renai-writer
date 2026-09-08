import type { EngagementReply, WatchedPost } from "@prisma/client";
import { prisma } from "../db/client";
import { postIssueComment, closeIssue } from "../lib/github";

// X APIの自動化ルール(Automation Rules)は、自分のアカウントがメンションされていない
// 他アカウントの投稿への自動リプライを禁止している(2026年2月の運用強化以降、明確に
// 適用範囲。https://help.x.com/en/rules-and-policies/x-automation)。ウォッチ対象の
// 投稿は当然自分宛てのメンションではないため、この機能はAPI経由での自動投稿を行わない。
//
// 承認済みリプライの最終処理は、DB更新とissue通知のみ(X APIへの書き込みは一切行わない)。
// issueには「この文面をXアプリ等から手動で投稿してください」という案内を残す。
// 手動承認フロー(handleEngagementApproval.ts)からも、autoモードでの即時確定
// (generateEngagementReplies.ts)からも同じ関数を呼ぶ。
export async function finalizeEngagementReply(
  reply: EngagementReply & { watchedPost: WatchedPost }
): Promise<void> {
  const issueRef =
    reply.githubIssueOwner && reply.githubIssueRepo && reply.githubIssueNumber
      ? { owner: reply.githubIssueOwner, repo: reply.githubIssueRepo, number: reply.githubIssueNumber }
      : null;

  await prisma.engagementReply.update({ where: { id: reply.id }, data: { status: "approved" } });
  await prisma.watchedPost.update({ where: { id: reply.watchedPost.id }, data: { status: "drafted" } });

  if (issueRef) {
    await postIssueComment(
      issueRef.owner,
      issueRef.repo,
      issueRef.number,
      "この文面でXアプリ等から手動でリプライを投稿してください。X APIの自動化ルール上、" +
        "自分宛てのメンションでない投稿への自動リプライはできないため、投稿はAPI経由では行いません。"
    );
    await closeIssue(issueRef.owner, issueRef.repo, issueRef.number);
  }
}
