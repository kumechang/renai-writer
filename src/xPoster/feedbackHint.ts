import { prisma } from "../db/client";

// フィードバックループ: 却下理由(投稿前)と、投稿後に運用者がissueへ残した「気になる」
// コメント(feedbackNotes)の両方を、次回生成時の「避けるべき方向性」ヒントとして
// 1つのテキストにまとめる(amazon-sentaku-shiageのpostConditions.ts buildRejectionHintを流用し、
// 承認モードがautoでも事後フィードバックを拾えるよう拡張したもの)。
export async function buildFeedbackHint(window: number): Promise<string | null> {
  const rejected = await prisma.xPost.findMany({
    where: { status: "rejected", rejectionReason: { not: null } },
    include: { article: { select: { title: true } } },
    orderBy: { updatedAt: "desc" },
    take: window,
  });

  const flagged = await prisma.xPost.findMany({
    where: { feedbackNotes: { not: null } },
    include: { article: { select: { title: true } } },
    orderBy: { feedbackAt: "desc" },
    take: window,
  });

  const entries: { at: Date; label: string; reason: string }[] = [];

  for (const post of rejected) {
    if (!post.rejectionReason) continue;
    entries.push({ at: post.updatedAt, label: post.article.title, reason: `却下理由: ${post.rejectionReason}` });
  }
  for (const post of flagged) {
    if (!post.feedbackNotes || !post.feedbackAt) continue;
    entries.push({ at: post.feedbackAt, label: post.article.title, reason: `投稿後の指摘: ${post.feedbackNotes}` });
  }

  if (entries.length === 0) return null;

  entries.sort((a, b) => b.at.getTime() - a.at.getTime());
  const lines = entries.slice(0, window).map((e) => `- [${e.label}] ${e.reason}`);

  return [
    "直近、以下のような指摘(却下理由・投稿後のフィードバック)があります。同じ問題を繰り返さないでください:",
    ...lines,
  ].join("\n");
}
