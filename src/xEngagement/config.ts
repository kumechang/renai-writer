import { readFileSync } from "node:fs";
import path from "node:path";

export interface XEngagementConfig {
  // manual: GitHub issueで人が「承認」とコメントするまで下書きを確定しない /
  // auto: セルフチェック合格時に即座に下書きを確定する。
  // どちらの場合も、実際にXへ投稿するのは運用者が手動で行う(X APIの自動化ルール上、
  // 自分宛てのメンションでない投稿への自動リプライ投稿はできないため)。
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

  // ウォッチ対象アカウントの新着投稿チェック(fetchNewPosts)を、そのアカウントの
  // 過去の投稿時間帯から外れている場合はスキップし、X API呼び出し数を抑える
  // (postingTimeProfile.ts)。過去の投稿件数がこの件数未満のアカウントは
  // 時間帯を判断できないため、毎回チェックする(ブートストラップ)。
  minPostHistoryForTimeFiltering: number;
  // 過去の投稿時刻(JST時)から、現在時刻がこの時間数以内ならチェック対象にする。
  activeHourWindow: number;
}

const CONFIG_PATH = path.resolve(process.cwd(), "config/x-engagement.json");

let cached: XEngagementConfig | undefined;

// config/x-engagement.json を読み込む。プロセス内で使い回すため一度読んだらキャッシュする。
export function loadXEngagementConfig(): XEngagementConfig {
  if (cached) return cached;
  cached = JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as XEngagementConfig;
  return cached;
}
