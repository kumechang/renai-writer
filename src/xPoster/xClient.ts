import { TwitterApi } from "twitter-api-v2";
import { xEnv } from "./env";

let client: TwitterApi | undefined;

// OAuth 1.0aのユーザーコンテキスト認証(投稿に必要。amazon-sentaku-shiageのxClient.tsを流用)。
export function getXClient(): TwitterApi {
  if (client) return client;
  client = new TwitterApi({
    appKey: xEnv.apiKey,
    appSecret: xEnv.apiSecret,
    accessToken: xEnv.accessToken,
    accessSecret: xEnv.accessSecret,
  });
  return client;
}
