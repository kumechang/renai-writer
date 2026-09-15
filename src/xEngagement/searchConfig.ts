import { readFileSync } from "node:fs";
import path from "node:path";

export interface XEngagementSearchConfig {
  // ジャンル横断のキーワード検索クエリ(X APIの検索クエリ構文)。特定アカウントに限定せず、
  // ジャンル内で反響のある投稿を広く拾うための入り口。1回のAPI呼び出しにまとめるため、
  // 複数クエリに分けずOR演算子で1つの文字列にする(呼び出し回数が増えるとコストも増えるため)。
  searchQuery: string;
  // 1回の検索で取得する件数。X APIの読み取りは返ってきた件数に応じて課金され
  // (2026年時点で投稿1件あたり約$0.005)、この検索はユーザー情報を取得しない
  // (ユーザー読み取りは1件あたり約$0.010かかるため、コストを固定するために取得しない)。
  // X APIの仕様上10件未満は指定できない。
  maxResults: number;
  // このインプレッション数(閲覧数)以上の投稿だけをリプライ候補として採用する。
  impressionThreshold: number;
}

const CONFIG_PATH = path.resolve(process.cwd(), "config/x-engagement-search.json");

export function loadXEngagementSearchConfig(): XEngagementSearchConfig {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as XEngagementSearchConfig;
}
