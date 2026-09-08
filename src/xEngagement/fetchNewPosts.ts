import type { WatchedAccount } from "@prisma/client";
import { prisma } from "../db/client";
import { getXClient } from "../xPoster/xClient";
import { hasXCredentials } from "../xPoster/env";
import { syncWatchedAccounts } from "./syncWatchedAccounts";
import { loadXEngagementConfig } from "./config";
import { shouldCheckAccountNow } from "./postingTimeProfile";

// 1アカウントあたり取得する最新投稿件数(X APIの最小値。既にtweetIdを保存済みのものは
// insertでスキップされるため、多めに取る必要はない)。
const TIMELINE_MAX_RESULTS = 5;

export interface FetchNewPostsResult {
  accountsChecked: number;
  accountsSkipped: number;
  newPosts: number;
}

// ウォッチ対象アカウント(config/x-watch-accounts.jsonと同期済みのWatchedAccount)ごとに、
// 直近の投稿(リツイート・リプライを除く本人の投稿のみ)を取得し、まだ保存していない
// ものをWatchedPostとして新規作成する。X APIキー未設定の場合は何もせず終える
// (ドライラン運用中でもエラーで落とさないため)。
//
// アカウント数が増えるほどX APIの呼び出し数(1アカウント1呼び出し)が線形に増えるため、
// 過去の投稿時間帯から明らかに外れているアカウントはチェックをスキップする
// (shouldCheckAccountNow)。新規登録アカウント(投稿履歴がまだ少ない)はブートストラップ
// 期間として毎回チェックする。
export async function fetchNewPosts(): Promise<FetchNewPostsResult> {
  const config = loadXEngagementConfig();
  const accounts = await syncWatchedAccounts();
  const activeAccounts = accounts.filter((a) => a.active);

  if (!hasXCredentials()) {
    console.warn("[x-engagement] X API credentials not configured, skipping fetch");
    return { accountsChecked: 0, accountsSkipped: 0, newPosts: 0 };
  }

  const now = new Date();
  let checked = 0;
  let skipped = 0;
  let newPosts = 0;

  for (const account of activeAccounts) {
    if (!(await shouldCheckAccountNow(account.id, now, config))) {
      skipped += 1;
      continue;
    }
    checked += 1;
    newPosts += await fetchNewPostsForAccount(account);
  }

  return { accountsChecked: checked, accountsSkipped: skipped, newPosts };
}

async function fetchNewPostsForAccount(account: WatchedAccount): Promise<number> {
  const client = getXClient();

  const xUserId = account.xUserId ?? (await resolveAndCacheUserId(account));
  if (!xUserId) return 0;

  const timeline = await client.v2.userTimeline(xUserId, {
    max_results: TIMELINE_MAX_RESULTS,
    exclude: ["retweets", "replies"],
    "tweet.fields": ["created_at"],
  });

  let created = 0;
  for (const tweet of timeline.tweets) {
    const existing = await prisma.watchedPost.findUnique({ where: { tweetId: tweet.id } });
    if (existing) continue;

    await prisma.watchedPost.create({
      data: {
        watchedAccountId: account.id,
        tweetId: tweet.id,
        text: tweet.text,
        postedAt: tweet.created_at ? new Date(tweet.created_at) : new Date(),
      },
    });
    created += 1;
  }

  return created;
}

async function resolveAndCacheUserId(account: WatchedAccount): Promise<string | null> {
  try {
    const user = await getXClient().v2.userByUsername(account.username);
    if (!user.data?.id) return null;
    await prisma.watchedAccount.update({ where: { id: account.id }, data: { xUserId: user.data.id } });
    return user.data.id;
  } catch (error) {
    console.warn(`[x-engagement] failed to resolve user id for @${account.username}: ${String(error)}`);
    return null;
  }
}
