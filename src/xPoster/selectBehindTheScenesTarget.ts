import type { Article, Draft, Plan } from "@prisma/client";
import { prisma } from "../db/client";
import { PROMOTABLE_ARTICLE_STATUSES } from "./selectArticle";
import { findOriginSession, isArticlePublished } from "./articlePublication";

export const BEHIND_THE_SCENES_TOPICS = ["theme", "title", "structure"] as const;
export type BehindTheScenesTopic = (typeof BEHIND_THE_SCENES_TOPICS)[number];

export interface BehindTheScenesTarget {
  article: Article;
  draft: Draft;
  plan: Plan;
  topic: BehindTheScenesTopic;
}

const IN_FLIGHT_STATUSES = ["pending_approval", "approved"];

// 公開済み(issueクローズ済み)の記事の中から、「制作裏話」(なぜこのテーマ/なぜこの
// タイトル/どういう構成)3トピックのうち、まだ投稿していないものが残っている記事を
// ランダムに1件選び、そのうちの1トピックを選ぶ。記事ごとにGitHub APIを呼ぶため、
// 記事数が多いと時間がかかる点に注意(findUrlThreadCandidateと同様)。
export async function selectBehindTheScenesTarget(): Promise<BehindTheScenesTarget | null> {
  const articles = await prisma.article.findMany({
    where: { status: { in: PROMOTABLE_ARTICLE_STATUSES } },
    include: {
      drafts: { orderBy: { revisionNumber: "desc" }, take: 1 },
      plan: true,
      xPosts: { where: { postKind: "behind_the_scenes" } },
    },
  });

  const candidates: BehindTheScenesTarget[] = [];

  for (const article of articles) {
    const draft = article.drafts[0];
    if (!draft) continue;

    const inFlight = article.xPosts.some((post) => IN_FLIGHT_STATUSES.includes(post.status));
    if (inFlight) continue;

    const usedTopics = new Set(
      article.xPosts
        .map((post) => post.behindTheScenesTopic)
        .filter((topic): topic is BehindTheScenesTopic => topic != null)
    );
    const remainingTopics = BEHIND_THE_SCENES_TOPICS.filter((topic) => !usedTopics.has(topic));
    if (remainingTopics.length === 0) continue;

    const originSession = await findOriginSession(article.id);
    if (!(await isArticlePublished(originSession))) continue;

    const topic = remainingTopics[Math.floor(Math.random() * remainingTopics.length)];
    candidates.push({ article, draft, plan: article.plan, topic });
  }

  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
