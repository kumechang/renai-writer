import { prisma } from "../db/client";
import { getXClient } from "./xClient";
import { hasXCredentials } from "./env";
import { getJstDateString } from "./time";

export interface AccountSnapshotInput {
  // JSTのカレンダー日("YYYY-MM-DD")。
  capturedOn: string;
  followers: number;
  following?: number | null;
  tweetCount?: number | null;
  source: "api" | "manual";
}

// 同じ日のスナップショットがあれば上書きする(1日1件)。
export async function saveAccountSnapshot(input: AccountSnapshotInput) {
  const data = {
    followers: input.followers,
    following: input.following ?? null,
    tweetCount: input.tweetCount ?? null,
    source: input.source,
  };
  return prisma.accountSnapshot.upsert({
    where: { capturedOn: input.capturedOn },
    create: { capturedOn: input.capturedOn, ...data },
    update: { capturedAt: new Date(), ...data },
  });
}

// X APIから、今のフォロワー数・フォロー数・投稿数を取得して、今日(JST)のスナップショットとして記録する。
// GET /2/users/me を1回読むだけ(2026年10月時点の料金ページでは、ユーザー情報の読み取りは1回約$0.010。
// 毎日1回で月約$0.30)。認証情報が無ければ何もしない。
export async function recordAccountSnapshot(now: Date = new Date()) {
  if (!hasXCredentials()) {
    console.warn("[x-poster] X API credentials not configured, skipping account snapshot");
    return null;
  }
  const me = await getXClient().v2.me({ "user.fields": ["public_metrics"] });
  const metrics = me.data.public_metrics;
  if (!metrics || typeof metrics.followers_count !== "number") {
    throw new Error("GET /2/users/me のレスポンスに followers_count を含む public_metrics がありません");
  }
  const snapshot = await saveAccountSnapshot({
    capturedOn: getJstDateString(now),
    followers: metrics.followers_count,
    following: metrics.following_count ?? null,
    tweetCount: metrics.tweet_count ?? null,
    source: "api",
  });
  console.log(`[x-poster] account snapshot ${snapshot.capturedOn}: followers=${snapshot.followers}`);
  return snapshot;
}

export interface FollowerTrendRow {
  date: string;
  followers: number;
  // 直前に記録のある日との差。最初の行はnull。
  delta: number | null;
  source: string;
}

// 純粋関数: スナップショット(日付の昇順)から、日ごとの増減を計算する。
export function computeFollowerTrend(
  snapshots: { capturedOn: string; followers: number; source: string }[]
): FollowerTrendRow[] {
  const sorted = [...snapshots].sort((a, b) => a.capturedOn.localeCompare(b.capturedOn));
  return sorted.map((s, i) => ({
    date: s.capturedOn,
    followers: s.followers,
    delta: i === 0 ? null : s.followers - sorted[i - 1].followers,
    source: s.source,
  }));
}

export async function collectFollowerTrend(days: number, now: Date = new Date()): Promise<FollowerTrendRow[]> {
  // 増減の起点を取るため、期間の1日前から取得する。
  const from = getJstDateString(new Date(now.getTime() - (days + 1) * 24 * 60 * 60 * 1000));
  const snapshots = await prisma.accountSnapshot.findMany({
    where: { capturedOn: { gte: from } },
    orderBy: { capturedOn: "asc" },
    select: { capturedOn: true, followers: true, source: true },
  });
  return computeFollowerTrend(snapshots).slice(-days);
}
