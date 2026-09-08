import { prisma } from "../db/client";

// フィードバックループ: 却下理由(投稿前)と、投稿後に運用者がissueへ残した「気になる」
// コメント(feedbackNotes)の両方を、次回生成時の「避けるべき方向性」ヒントとして
// 1つのテキストにまとめる(src/xPoster/feedbackHint.tsと同じ考え方)。
export async function buildEngagementFeedbackHint(window: number): Promise<string | null> {
  const rejected = await prisma.engagementReply.findMany({
    where: { status: "rejected", rejectionReason: { not: null } },
    include: { watchedPost: { include: { watchedAccount: true } } },
    orderBy: { updatedAt: "desc" },
    take: window,
  });

  const flagged = await prisma.engagementReply.findMany({
    where: { feedbackNotes: { not: null } },
    include: { watchedPost: { include: { watchedAccount: true } } },
    orderBy: { feedbackAt: "desc" },
    take: window,
  });

  const entries: { at: Date; label: string; reason: string }[] = [];

  for (const reply of rejected) {
    if (!reply.rejectionReason) continue;
    const label = `@${reply.watchedPost.watchedAccount.username}への返信`;
    entries.push({ at: reply.updatedAt, label, reason: `却下理由: ${reply.rejectionReason}` });
  }
  for (const reply of flagged) {
    if (!reply.feedbackNotes || !reply.feedbackAt) continue;
    const label = `@${reply.watchedPost.watchedAccount.username}への返信`;
    entries.push({ at: reply.feedbackAt, label, reason: `投稿後の指摘: ${reply.feedbackNotes}` });
  }

  if (entries.length === 0) return null;

  entries.sort((a, b) => b.at.getTime() - a.at.getTime());
  const lines = entries.slice(0, window).map((e) => `- [${e.label}] ${e.reason}`);

  return [
    "直近、以下のような指摘(却下理由・投稿後のフィードバック)があります。同じ問題を繰り返さないでください:",
    ...lines,
  ].join("\n");
}
