import type { Article } from "@prisma/client";
import { prisma } from "../db/client";

// Xで告知してよい記事のステータス(条件付き成立を含む。要人間確認の記事は対象外)。
export const PROMOTABLE_ARTICLE_STATUSES = ["accepted", "accepted_with_reservation"];

// 承認待ち・承認済みのXPostがある記事は処理中なので、古さに関わらず再選択しない。
const IN_FLIGHT_STATUSES = ["pending_approval", "approved"];
// 実際にXへ出た(または出たことにした)投稿。再宣伝のクールダウン判定の基準にする。
const LIVE_STATUSES = ["posted", "posted_dryrun"];
const ALREADY_PROMOTED_OR_IN_FLIGHT = [...IN_FLIGHT_STATUSES, ...LIVE_STATUSES];

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

// まだXで宣伝していない完成記事の中から1件をランダムに選ぶ
// (「毎回投稿を考えるときに完成記事の中からネタを拾ってほしい」という運用を想定し、
// issue番号を都度指定しなくても済むようにする)。
//
// 1日8件ペースなど、書き下ろし記事だけでは目標本数を満たせない運用を想定し、
// 未宣伝の記事が無くなった場合はcooldownDays日以上前に宣伝した記事を再選択候補にする
// (処理中(pending_approval/approved)の記事は、古さに関わらず再選択しない)。
export async function selectArticleForPost(cooldownDays: number): Promise<Article> {
  const articles = await prisma.article.findMany({
    where: { status: { in: PROMOTABLE_ARTICLE_STATUSES } },
    include: { xPosts: true },
  });

  const neverPromoted = articles.filter(
    (article) => !article.xPosts.some((post) => ALREADY_PROMOTED_OR_IN_FLIGHT.includes(post.status))
  );
  if (neverPromoted.length > 0) {
    return pickRandom(neverPromoted);
  }

  const inFlightIds = new Set(
    articles
      .filter((article) => article.xPosts.some((post) => IN_FLIGHT_STATUSES.includes(post.status)))
      .map((article) => article.id)
  );

  const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const eligibleForRepromotion = articles.filter((article) => {
    if (inFlightIds.has(article.id)) return false;
    const lastLivePostedAt = article.xPosts
      .filter((post) => LIVE_STATUSES.includes(post.status))
      .map((post) => post.updatedAt.getTime())
      .sort((a, b) => b - a)[0];
    if (lastLivePostedAt == null) return false;
    return now - lastLivePostedAt >= cooldownMs;
  });

  if (eligibleForRepromotion.length > 0) {
    return pickRandom(eligibleForRepromotion);
  }

  throw new Error(
    "宣伝可能な記事が見つかりませんでした" +
      `(status が accepted / accepted_with_reservation の記事のうち、未宣伝のものが無く、` +
      `再宣伝可能(前回の投稿から${cooldownDays}日以上経過)な記事もありません)。`
  );
}
