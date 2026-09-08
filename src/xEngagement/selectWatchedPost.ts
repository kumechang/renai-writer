import type { WatchedPost } from "@prisma/client";
import { prisma } from "../db/client";
import type { XEngagementConfig } from "./config";

// 「彼らが投稿した瞬間に」リプライを返すというアドバイスの狙いを外さないよう、
// 未対応(status: "new")の投稿のうち、投稿から時間が経ちすぎていないもの
// (maxPostAgeMinutes以内)を、投稿日時が古い順(検知が遅れたものを優先)で1件選ぶ。
// 対象が無ければnullを返す。
export async function selectWatchedPost(config: XEngagementConfig, now: Date): Promise<WatchedPost | null> {
  const oldestAllowed = new Date(now.getTime() - config.maxPostAgeMinutes * 60 * 1000);

  const post = await prisma.watchedPost.findFirst({
    where: { status: "new", postedAt: { gte: oldestAllowed } },
    orderBy: { postedAt: "asc" },
  });

  return post ?? null;
}

// maxPostAgeMinutesを超えて放置された未対応投稿を、二度と対象にならないようskip扱いにする
// (古い投稿が延々とキューに残り続けるのを防ぐ)。
export async function skipStalePosts(config: XEngagementConfig, now: Date): Promise<number> {
  const oldestAllowed = new Date(now.getTime() - config.maxPostAgeMinutes * 60 * 1000);
  const result = await prisma.watchedPost.updateMany({
    where: { status: "new", postedAt: { lt: oldestAllowed } },
    data: { status: "skipped" },
  });
  return result.count;
}
