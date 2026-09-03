import type { Article } from "@prisma/client";
import { prisma } from "../db/client";

// Xで告知してよい記事のステータス(条件付き成立を含む。要人間確認の記事は対象外)。
export const PROMOTABLE_ARTICLE_STATUSES = ["accepted", "accepted_with_reservation"];

// 承認待ち・承認済み・投稿済みのXPostが既にある記事は「宣伝済み(または宣伝中)」とみなし、
// 選択対象から除外する。却下・投稿失敗のみの記事は未宣伝として扱い、再挑戦できるようにする。
const ALREADY_PROMOTED_STATUSES = ["pending_approval", "approved", "posted", "posted_dryrun"];

// まだXで宣伝していない完成記事の中から1件をランダムに選ぶ
// (「毎回投稿を考えるときに完成記事の中からネタを拾ってほしい」という運用を想定し、
// issue番号を都度指定しなくても済むようにする)。
export async function selectArticleForPost(): Promise<Article> {
  const candidates = await prisma.article.findMany({
    where: {
      status: { in: PROMOTABLE_ARTICLE_STATUSES },
      xPosts: { none: { status: { in: ALREADY_PROMOTED_STATUSES } } },
    },
  });

  if (candidates.length === 0) {
    throw new Error(
      "宣伝可能な未投稿の記事が見つかりませんでした" +
        "(status が accepted / accepted_with_reservation で、まだXPostが無い記事がありません)。"
    );
  }

  return candidates[Math.floor(Math.random() * candidates.length)];
}
