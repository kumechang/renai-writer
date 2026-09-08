// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import type { EngagementReply } from "@prisma/client";
import { prisma } from "../db/client";
import { parseEngagementApprovalEvent, type EngagementApprovalEvent } from "../xEngagement/approval";
import { finalizeEngagementReply } from "../xEngagement/finalizeReply";
import { postIssueComment, closeIssue } from "../lib/github";

// GitHub Actions (x-engagement-approval.yml, issue_commentイベント) から実行される
// エントリポイント。承認issueへのコメントを検知し、
//   - 承認/却下前のリプライへの「承認」「却下」コメント → 承認ならXへ投稿、却下ならそこで終了
//   - それ以外のコメント(自由記述、または既に処理済みのリプライへの後追いコメント) →
//     次回以降の生成に活かすフィードバックとして記録
// を行う(src/cli/handleXPostApproval.tsと同じ構成)。
async function main() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    throw new Error("GITHUB_EVENT_PATH is not set");
  }

  const event = parseEngagementApprovalEvent(eventPath);
  if (event.decision === "ignore") {
    console.log(`comment ignored (no matching label, or bot's own comment) issue=#${event.issueNumber}`);
    return;
  }

  const reply = await prisma.engagementReply.findFirst({
    where: { githubIssueNumber: event.issueNumber },
    include: { watchedPost: true },
  });
  if (!reply) {
    console.warn(`no EngagementReply found for issue #${event.issueNumber}`);
    return;
  }
  if (!reply.githubIssueOwner || !reply.githubIssueRepo) {
    throw new Error(`EngagementReply(${reply.id}) has no githubIssueOwner/githubIssueRepo (内部エラー)`);
  }
  const { githubIssueOwner: owner, githubIssueRepo: repo } = reply;

  // post_failedからの再承認(投稿失敗後のリトライ)は許容するが、それ以外の
  // 承認待ち状態でない投稿への「承認」「却下」コメントは、承認/却下の判定をやり直さず
  // フィードバックとして記録する。
  const actionable = reply.status === "pending_approval" || reply.status === "post_failed";

  if (event.decision === "approve" && actionable) {
    const approved = await prisma.engagementReply.update({
      where: { id: reply.id },
      data: { status: "approved", approvedBy: event.commenter },
      include: { watchedPost: true },
    });
    await finalizeEngagementReply(approved);
    console.log(`reply approved and finalized (replyId=${reply.id})`);
    return;
  }

  if (event.decision === "reject" && actionable) {
    await prisma.engagementReply.update({
      where: { id: reply.id },
      data: { status: "rejected", rejectedBy: event.commenter, rejectionReason: event.commentBody },
    });
    await postIssueComment(owner, repo, event.issueNumber, `@${event.commenter} により却下されました。`);
    await closeIssue(owner, repo, event.issueNumber);
    console.log(`reply rejected (replyId=${reply.id})`);
    return;
  }

  await recordFeedback(reply, event, owner, repo);
}

// 承認/却下のキーワードを含まない自由記述コメント、または既に処理済みのリプライへの
// コメントを、次回以降の生成時に参照するフィードバックとしてEngagementReplyに蓄積する。
async function recordFeedback(
  reply: EngagementReply,
  event: EngagementApprovalEvent,
  owner: string,
  repo: string
): Promise<void> {
  const entry = `[${new Date().toISOString()}] @${event.commenter}: ${event.commentBody}`;
  const notes = reply.feedbackNotes ? `${reply.feedbackNotes}\n---\n${entry}` : entry;

  await prisma.engagementReply.update({
    where: { id: reply.id },
    data: { feedbackNotes: notes, feedbackBy: event.commenter, feedbackAt: new Date() },
  });
  await postIssueComment(
    owner,
    repo,
    event.issueNumber,
    "フィードバックとして記録しました。次回以降のリプライ生成の参考にします。"
  );
  console.log(`feedback recorded (replyId=${reply.id}, issue=#${event.issueNumber})`);
}

main().catch((error) => {
  console.error("handle-engagement-approval failed", error);
  process.exitCode = 1;
});
