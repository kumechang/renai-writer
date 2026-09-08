import { readFileSync } from "node:fs";
import path from "node:path";

export interface XEngagementConfig {
  // manual: GitHub issueでの人による承認後にリプライを投稿する / auto: セルフチェック合格時に即時投稿する
  approvalMode: "manual" | "auto";
  claudeModel: string;
  xCharLimit: number;
  selfCheckPassThreshold: number;
  // 文字数超過時、生成+セルフチェックをやり直す最大回数
  maxGenerateRetries: number;

  // 1日あたりのリプライ上限。「毎日3〜5回」というアドバイスに沿ってペースを抑える
  // (数を追うより、1件ずつ心のこもったリプライを返すことを優先する)。
  maxRepliesPerDay: number;
  // ウォッチ対象の投稿を検知していて不自然でない時間帯(JST)。この範囲内でのみリプライを試みる。
  replyWindow: {
    startHour: number;
    endHour: number;
  };
  // 直近のリプライ生成からこの時間(分)未満なら、次の生成をスキップする(連投防止)。
  minSpacingMinutes: number;
  // 直近の却下・事後フィードバックのうち、次回生成時のヒントとして渡す件数。
  recentFeedbackWindow: number;
  // 投稿からこの分数を超えて経過したものにはリプライしない(「投稿した瞬間に」返す
  // というアドバイスの狙いを外さないため。古い投稿への今更のリプライは避ける)。
  maxPostAgeMinutes: number;
}

const CONFIG_PATH = path.resolve(process.cwd(), "config/x-engagement.json");

let cached: XEngagementConfig | undefined;

// config/x-engagement.json を読み込む。プロセス内で使い回すため一度読んだらキャッシュする。
export function loadXEngagementConfig(): XEngagementConfig {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as XEngagementConfig;
  return cached;
}
