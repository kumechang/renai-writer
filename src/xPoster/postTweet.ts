import { getXClient } from "./xClient";
import { hasXCredentials } from "./env";
import { getWeightedLength } from "./tweetLength";

export interface PostTweetResult {
  dryRun: boolean;
  tweetId: string;
  tweetUrl: string;
}

export class TweetTooLongError extends Error {}

// 文字数ガード付きの投稿(amazon-sentaku-shiageのpostTweet.tsを流用)。
// セルフチェック済みの本文を投稿直前に黙って切り詰めると意味が変わってしまうため、
// 超過時は投稿せず例外として扱う。
export async function postTweet(text: string, charLimit: number): Promise<PostTweetResult> {
  const weightedLength = getWeightedLength(text);
  if (weightedLength > charLimit) {
    throw new TweetTooLongError(`tweet exceeds char limit: ${weightedLength} > ${charLimit}`);
  }

  if (!hasXCredentials()) {
    // X APIキー未設定でも処理を止めず、ログのみでドライラン扱いにする。
    console.warn(`[x-poster] X API credentials not configured, skipping actual post (dry-run): ${text}`);
    return { dryRun: true, tweetId: "", tweetUrl: "" };
  }

  const result = await getXClient().v2.tweet(text);
  const tweetId = result.data.id;
  return {
    dryRun: false,
    tweetId,
    tweetUrl: `https://x.com/i/web/status/${tweetId}`,
  };
}
