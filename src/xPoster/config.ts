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

  // 1日あたりの目標投稿数。generate-postsは投稿可能時間帯の間毎時起動するが、
  // 実際に生成するかはshouldGenerateNowがこの目標値をもとに確率的に判断する
  // (amazon-sentaku-shiageと同じ設計)。
  targetPostsPerDay: number;
  // ターゲット読者が投稿を見ていて不自然でない時間帯(JST)。この範囲内でのみ生成を試みる。
  postingWindow: {
    startHour: number;
    endHour: number;
  };
  // 直近の投稿候補作成からこの時間(h)未満なら、次の生成をスキップする(連投防止)。
  minSpacingHours: number;
  // 一度Xで宣伝した記事を再び宣伝候補に戻すまでの日数。書き下ろし記事だけでは
  // targetPostsPerDayを満たせない場合に、この日数以上前に宣伝した記事を再利用する。
  repromotionCooldownDays: number;
  // 直近の却下・事後フィードバックのうち、次回生成時のヒントとして渡す件数。
  recentFeedbackWindow: number;
}

const CONFIG_PATH = path.resolve(process.cwd(), "config/x-poster.json");

let cached: XPosterConfig | undefined;

// config/x-poster.json を読み込む。プロセス内で使い回すため一度読んだらキャッシュする。
export function loadXPosterConfig(): XPosterConfig {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as XPosterConfig;
  return cached;
}
