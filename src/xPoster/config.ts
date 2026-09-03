import { readFileSync } from "node:fs";
import path from "node:path";

export interface XPosterConfig {
  // manual: GitHub issueでの人による承認後にXへ投稿する / auto: セルフチェック合格時に即時投稿する
  approvalMode: "manual" | "auto";
  claudeModel: string;
  xCharLimit: number;
  selfCheckPassThreshold: number;
  // 文字数超過時、生成+セルフチェックをやり直す最大回数
  maxGenerateRetries: number;
}

const CONFIG_PATH = path.resolve(process.cwd(), "config/x-poster.json");

let cached: XPosterConfig | undefined;

// config/x-poster.json を読み込む。プロセス内で使い回すため一度読んだらキャッシュする。
export function loadXPosterConfig(): XPosterConfig {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as XPosterConfig;
  return cached;
}
