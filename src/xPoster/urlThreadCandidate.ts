import type { Article, Draft } from "@prisma/client";
import { prisma } from "../db/client";
import { getJstDateString } from "./time";
import { PROMOTABLE_ARTICLE_STATUSES } from "./selectArticle";
import { findOriginSession, isArticlePublished, findPublishedArticleUrl } from "./articlePublication";

// 承認待ち・承認済みの記事URL付き投稿は処理中とみなし、日次上限のカウントにも含める
// (承認結果が出る前に重複して生成しないため)。
const IN_FLIGHT_STATUSES = ["pending_approval", "approved"];
const LIVE_STATUSES = ["posted", "posted_dryrun"];

// 今日(JST)、既にurlPostsPerDay件の記事URL付き投稿を作っている(または作成中の)かどうか。
export async function hasReachedDailyUrlPostLimit(urlPostsPerDay: number): Promise<boolean> {
  if (urlPostsPerDay <= 0) return true;

  const todayJst = getJstDateString(new Date());
  const posts = await prisma.xPost.findMany({
    where: { articleUrl: { not: null }, status: { in: [...IN_FLIGHT_STATUSES, ...LIVE_STATUSES] } },
    select: { createdAt: true },
  });
  const countToday = posts.filter((post) => getJstDateString(post.createdAt) === todayJst).length;
  return countToday >= urlPostsPerDay;
}

export interface UrlThreadCandidate {
  article: Article;
  draft: Draft;
  articleUrl: string;
}

// 公開済み(issueクローズ済み)かつ最後のコメントに記事URLが貼られている記事の中から、
// まだURL付き投稿を作っていない(処理中でない、または前回の投稿からcooldownDays日以上
// 経った)ものをランダムに1件選ぶ。記事ごとにGitHub APIを呼ぶため、記事数が多いと
// 時間がかかる点に注意(現状の記事数であれば実用上問題にならない想定)。
export async function findUrlThreadCandidate(cooldownDays: number): Promise<UrlThreadCandidate | null> {
  const articles = await prisma.article.findMany({
    where: { status: { in: PROMOTABLE_ARTICLE_STATUSES } },
    include: {
      drafts: { orderBy: { revisionNumber: "desc" }, take: 1 },
      xPosts: { where: { articleUrl: { not: null } } },
    },
  });

  const candidates: UrlThreadCandidate[] = [];
  const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;

  for (const article of articles) {
    const draft = article.drafts[0];
    if (!draft) continue;

    const urlPosts = article.xPosts;
    if (urlPosts.some((post) => IN_FLIGHT_STATUSES.includes(post.status))) continue;

    const lastLiveAt = urlPosts
      .filter((post) => LIVE_STATUSES.includes(post.status))
      .map((post) => post.updatedAt.getTime())
      .sort((a, b) => b - a)[0];
    if (lastLiveAt != null && Date.now() - lastLiveAt < cooldownMs) continue;

    const originSession = await findOriginSession(article.id);
    if (!(await isArticlePublished(originSession))) continue;

    const url = await findPublishedArticleUrl(originSession);
    if (!url) continue;

    candidates.push({ article, draft, articleUrl: url });
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
