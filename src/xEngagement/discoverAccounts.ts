import { readFileSync } from "node:fs";
import path from "node:path";
import { getXClient } from "../xPoster/xClient";
import { hasXCredentials } from "../xPoster/env";
import { loadWatchAccountsConfig } from "./watchAccountsConfig";

export interface DiscoveryConfig {
  // 検索キーワード(X APIの検索クエリ構文。lang:ja/-is:retweet等の演算子込みで書く)。
  // ジャンル(恋愛の執着・未練・片思いなど)に沿った投稿をしている人を広く拾うための入り口。
  searchQueries: string[];
  // 「フォロワー1万人以上の憧れのアカウント」の下限。上限は、フォロワーが多すぎて
  // 1件のリプライでは気付かれにくい超大型アカウントを除外し、リプライが実際に読まれる
  // 可能性のある規模に絞るためのもの。
  minFollowers: number;
  maxFollowers: number;
  // 候補として提示する最大件数(運用者が5〜10件選ぶための母数として、少し多めに出す)。
  maxCandidates: number;
}

const CONFIG_PATH = path.resolve(process.cwd(), "config/x-engagement-discovery.json");

export function loadDiscoveryConfig(): DiscoveryConfig {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as DiscoveryConfig;
}

export interface DiscoveredAccount {
  username: string;
  name: string;
  followersCount: number;
  description: string;
  matchedQuery: string;
  sampleTweetUrl: string;
}

// discoverAccountsが集めた「投稿+投稿者」の最小限の情報。X API呼び出しをモックしなくても
// 集計・フィルタ・ランキングのロジック(aggregateCandidates)だけを単体テストできるよう、
// X APIのレスポンス型からこの薄い形に変換してから渡す。
export interface CandidateEntry {
  tweetId: string;
  query: string;
  username: string;
  name: string;
  description?: string;
  protected?: boolean;
  followersCount: number;
}

// 検索結果(複数クエリ分の投稿+投稿者)から、ウォッチ候補アカウントを集計する純粋関数。
// - 鍵付き(protected)アカウントは除外(リプライを見てもらえない)
// - フォロワー数がmin〜maxの範囲外は除外
// - 既にconfig/x-watch-accounts.jsonに登録済みのアカウントは除外(重複提案しない)
// - 同一アカウントが複数の検索クエリにヒットした場合は最初の1件のみを採用
// - フォロワー数の多い順に並べ、maxCandidates件に絞る
export function aggregateCandidates(
  entries: CandidateEntry[],
  config: DiscoveryConfig,
  alreadyWatched: Set<string>
): DiscoveredAccount[] {
  const found = new Map<string, DiscoveredAccount>();

  for (const entry of entries) {
    if (entry.protected) continue;
    if (entry.followersCount < config.minFollowers || entry.followersCount > config.maxFollowers) continue;

    const key = entry.username.toLowerCase();
    if (alreadyWatched.has(key)) continue;
    if (found.has(key)) continue;

    found.set(key, {
      username: entry.username,
      name: entry.name,
      followersCount: entry.followersCount,
      description: (entry.description ?? "").slice(0, 140),
      matchedQuery: entry.query,
      sampleTweetUrl: `https://x.com/${entry.username}/status/${entry.tweetId}`,
    });
  }

  return Array.from(found.values())
    .sort((a, b) => b.followersCount - a.followersCount)
    .slice(0, config.maxCandidates);
}

// X APIの検索(直近の投稿検索)で、config/x-engagement-discovery.jsonのクエリごとに
// 投稿+投稿者情報を取得し、aggregateCandidatesで候補アカウントに絞り込む。
// config/x-watch-accounts.jsonに既に登録済みのアカウントは候補から除く。
export async function discoverAccounts(): Promise<DiscoveredAccount[]> {
  if (!hasXCredentials()) {
    throw new Error("X API credentials not configured (X_API_KEY等が未設定です)");
  }

  const config = loadDiscoveryConfig();
  const alreadyWatched = new Set(loadWatchAccountsConfig().map((a) => a.username.toLowerCase()));

  const client = getXClient();
  const entries: CandidateEntry[] = [];

  for (const query of config.searchQueries) {
    const result = await client.v2.search(query, {
      max_results: 100,
      expansions: ["author_id"],
      "user.fields": ["public_metrics", "description", "username", "name", "protected"],
    });

    for (const tweet of result.tweets) {
      const author = result.includes.author(tweet);
      if (!author) continue;

      entries.push({
        tweetId: tweet.id,
        query,
        username: author.username,
        name: author.name,
        description: author.description,
        protected: author.protected,
        followersCount: author.public_metrics?.followers_count ?? 0,
      });
    }
  }

  return aggregateCandidates(entries, config, alreadyWatched);
}
