import { parseTweet } from "twitter-text";

// CJK文字を2文字分として数えるX仕様の加重長を返す(amazon-sentaku-shiageと同じ算出方法)。
export function getWeightedLength(text: string): number {
  return parseTweet(text).weightedLength;
}
