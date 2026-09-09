import { readFileSync } from "node:fs";
import path from "node:path";

export interface XEngagementConfig {
  // リプライ検討プロンプトに書く文字数上限の目安(X投稿の全角文字数上限)。
  xCharLimit: number;
}

const CONFIG_PATH = path.resolve(process.cwd(), "config/x-engagement.json");

let cached: XEngagementConfig | undefined;

// config/x-engagement.json を読み込む。プロセス内で使い回すため一度読んだらキャッシュする。
export function loadXEngagementConfig(): XEngagementConfig {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as XEngagementConfig;
  return cached;
}
