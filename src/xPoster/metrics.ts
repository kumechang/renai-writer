import { prisma } from "../db/client";
import type { XPost } from "@prisma/client";

// XPostごとのエンゲージメントを「最新値で上書き」ではなくスナップショットとして時系列に
// 積んでいく(amazon-sentaku-shiageのmetricsRepo.tsを流用)。
export interface MetricsInput {
  xPostId: string;
  impressions: number | null;
  likes: number | null;
  reposts: number | null;
  replies: number | null;
  bookmarks: number | null;
}

// エンゲージメント率(いいね+リポスト+返信 / インプレッション)はここで計算して保存する。
export async function insertMetrics(input: MetricsInput): Promise<void> {
  const total = (input.likes ?? 0) + (input.reposts ?? 0) + (input.replies ?? 0);
  const engagementRate = input.impressions && input.impressions > 0 ? total / input.impressions : null;

  await prisma.xPostMetric.create({
    data: {
      xPostId: input.xPostId,
      impressions: input.impressions,
      likes: input.likes,
      reposts: input.reposts,
      replies: input.replies,
      bookmarks: input.bookmarks,
      engagementRate,
    },
  });
}

export async function listPostedWithinDays(days: number): Promise<XPost[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return prisma.xPost.findMany({
    where: { status: "posted", updatedAt: { gte: since }, tweetId: { not: null } },
  });
}

export interface PostEngagementSample {
  postedAt: Date;
  engagementRate: number;
}

// analyzePostingTimes用: 投稿ごとの最新エンゲージメント率スナップショットを、
// 投稿済み・計測済みの件数分だけ返す(時間帯別集計の元データ)。
export async function listLatestEngagementSamples(): Promise<PostEngagementSample[]> {
  const posts = await prisma.xPost.findMany({
    where: { status: "posted", metrics: { some: {} } },
    include: { metrics: { orderBy: { collectedAt: "desc" }, take: 1 } },
  });

  const samples: PostEngagementSample[] = [];
  for (const post of posts) {
    const latest = post.metrics[0];
    if (latest?.engagementRate == null) continue;
    samples.push({ postedAt: post.updatedAt, engagementRate: latest.engagementRate });
  }
  return samples;
}
