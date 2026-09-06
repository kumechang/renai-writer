import { getXClient } from "./xClient";
import { hasXCredentials } from "./env";
import { getWeightedLength } from "./tweetLength";

export interface PostTweetResult {
  dryRun: boolean;
  tweetId: string;
  tweetUrl: string;
}

export class TweetTooLongError extends Error {}

// X APIがエラーを投げずに200を返しつつ、なぜかtweetIdが空になる異常系が実運用で
// 1度観測された(2件目の返信投稿がinReplyToTweetId=""でX APIから拒否された)。
// 空のtweetIdをそのまま返すと呼び出し元がURLやreplyのinReplyToIdとして使ってしまい
// 気付きにくいため、この時点で明確なエラーとして扱う。
class MissingTweetIdError extends Error {}

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
  if (!tweetId) {
    throw new MissingTweetIdError(`X APIから投稿IDを取得できませんでした(レスポンス異常): ${JSON.stringify(result)}`);
  }
  return {
    dryRun: false,
    tweetId,
    tweetUrl: `https://x.com/i/web/status/${tweetId}`,
  };
}

// 自分の投稿への返信(2ツイート構成のスレッドの2件目、記事URLを含む核心部分など)。
// 文字数ガード・ドライラン挙動はpostTweetと同じ。
export async function postReply(text: string, inReplyToTweetId: string, charLimit: number): Promise<PostTweetResult> {
  const weightedLength = getWeightedLength(text);
  if (weightedLength > charLimit) {
    throw new TweetTooLongError(`reply exceeds char limit: ${weightedLength} > ${charLimit}`);
  }

  if (!hasXCredentials()) {
    console.warn(`[x-poster] X API credentials not configured, skipping actual reply (dry-run): ${text}`);
    return { dryRun: true, tweetId: "", tweetUrl: "" };
  }

  const result = await getXClient().v2.reply(text, inReplyToTweetId);
  const tweetId = result.data.id;
  if (!tweetId) {
    throw new MissingTweetIdError(`X APIから投稿IDを取得できませんでした(レスポンス異常): ${JSON.stringify(result)}`);
  }
  return {
    dryRun: false,
    tweetId,
    tweetUrl: `https://x.com/i/web/status/${tweetId}`,
  };
}
