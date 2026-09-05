import { getXClient } from "./xClient";
import { hasXCredentials } from "./env";
import { listPostedWithinDays, insertMetrics } from "./metrics";

// フィードバックループ: 直近days日分の投稿済みツイートのエンゲージメントを取得し、
// XPostMetricにスナップショットとして記録する。ここで貯めた数値をanalyzePostingTimesが
// 時間帯別の投稿重みに反映する(amazon-sentaku-shiageのcollectMetrics.tsを流用)。
export async function collectMetrics(days: number): Promise<number> {
  if (!hasXCredentials()) {
    console.warn("[x-poster] X API credentials not configured, skipping metrics collection");
    return 0;
  }

  const posts = (await listPostedWithinDays(days)).filter((post) => post.tweetId);
  if (posts.length === 0) {
    console.log("[x-poster] no posted tweets to collect metrics for");
    return 0;
  }

  const ids = posts.map((post) => post.tweetId as string);
  const response = await getXClient().v2.tweets(ids, { "tweet.fields": ["public_metrics"] });

  let count = 0;
  for (const post of posts) {
    const tweet = response.data.find((t) => t.id === post.tweetId);
    const publicMetrics = tweet?.public_metrics;
    if (!publicMetrics) continue;

    await insertMetrics({
      xPostId: post.id,
      impressions: publicMetrics.impression_count ?? null,
      likes: publicMetrics.like_count ?? null,
      reposts: publicMetrics.retweet_count ?? null,
      replies: publicMetrics.reply_count ?? null,
      bookmarks: publicMetrics.bookmark_count ?? null,
    });
    count += 1;
  }

  console.log(`[x-poster] collected metrics for ${count} post(s)`);
  return count;
}
