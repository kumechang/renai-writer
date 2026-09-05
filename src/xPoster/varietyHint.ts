import { prisma } from "../db/client";

const SUCCESSFUL_STATUSES = ["posted", "posted_dryrun"];

export type VarietyScope = { articleId: string } | { standalone: true };

// 同じ記事(または単発投稿)を何度も同じ切り口・同じ引用で書いてしまわないよう、
// 直近の投稿本文をプロンプトに渡して「違う切り口で書く」よう促すためのヒント
// (「記事を使い回すときは角度を変えてほしい」という運用要望に対応)。
export async function buildVarietyHint(scope: VarietyScope, window: number): Promise<string | null> {
  const where =
    "articleId" in scope
      ? { articleId: scope.articleId, status: { in: SUCCESSFUL_STATUSES } }
      : { articleId: null, status: { in: SUCCESSFUL_STATUSES } };

  const posts = await prisma.xPost.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: window,
    select: { finalText: true },
  });
  if (posts.length === 0) return null;

  const lines = posts.map((post, i) => `${i + 1}. ${post.finalText}`);
  return [
    "過去に投稿した内容です。同じ切り口・同じ引用・似た書き出しを繰り返さず、違う角度で書いてください:",
    ...lines,
  ].join("\n");
}
