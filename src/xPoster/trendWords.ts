import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../db/client";
import { getXClient } from "./xClient";
import { hasXCredentials } from "./env";

export interface TrendWordsConfig {
  // ジャンル(恋愛)に沿った検索語。discoverAccounts.tsと同じ投稿検索エンドポイントを使う。
  searchQueries: string[];
  // ヒントとして残す言葉の最大件数。
  maxWords: number;
  // この件数未満しか出現しなかった言葉は、たまたま1〜2件の投稿に含まれていただけの
  // ノイズとみなして除外する。
  minOccurrences: number;
}

const CONFIG_PATH = path.resolve(process.cwd(), "config/x-trend-words.json");

export function loadTrendWordsConfig(): TrendWordsConfig {
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as TrendWordsConfig;
}

export interface TrendWordCount {
  word: string;
  occurrences: number;
}

const HASHTAG_PATTERN = /#[^\s#]+/g;

// 投稿本文からハッシュタグを抜き出す(重複除去はしない。1件の投稿内で同じタグを
// 何度も使っているケースはaggregateTrendWords側で1回にまとめる)。
export function extractHashtags(text: string): string[] {
  return text.match(HASHTAG_PATTERN) ?? [];
}

// 複数の投稿本文から、ジャンル内で実際によく使われているハッシュタグを集計する純粋関数。
// 同じ投稿内で同じタグを繰り返し使っていても1回として数える(1件の投稿がカウントを
// 水増しするのを防ぐため)。minOccurrences未満の言葉は除外し、出現数の多い順に
// maxWords件まで返す。
export function aggregateTrendWords(tweetTexts: string[], config: TrendWordsConfig): TrendWordCount[] {
  const counts = new Map<string, number>();

  for (const text of tweetTexts) {
    const uniqueHashtags = new Set(extractHashtags(text));
    for (const tag of uniqueHashtags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .filter(([, occurrences]) => occurrences >= config.minOccurrences)
    .sort((a, b) => b[1] - a[1])
    .slice(0, config.maxWords)
    .map(([word, occurrences]) => ({ word, occurrences }));
}

// config/x-trend-words.jsonの検索語ごとにX APIの投稿検索(discoverAccounts.tsと同じ
// エンドポイント)を叩き、集めた投稿本文からトレンドワードを集計する。
export async function fetchTrendWords(): Promise<TrendWordCount[]> {
  if (!hasXCredentials()) {
    console.warn("[x-post] X API credentials not configured, skipping trend word collection");
    return [];
  }

  const config = loadTrendWordsConfig();
  const client = getXClient();
  const seenTweetIds = new Set<string>();
  const tweetTexts: string[] = [];

  for (const query of config.searchQueries) {
    const result = await client.v2.search(query, { max_results: 100 });
    for (const tweet of result.tweets) {
      if (seenTweetIds.has(tweet.id)) continue;
      seenTweetIds.add(tweet.id);
      tweetTexts.push(tweet.text);
    }
  }

  return aggregateTrendWords(tweetTexts, config);
}

// 直近の収集結果(TrendWord)から、投稿生成プロンプトに渡すヒント文を組み立てる。
// 収集結果が無い場合(未収集、またはX APIキー未設定など)はnullを返す。
export async function buildTrendHint(limit: number): Promise<string | null> {
  const words = await prisma.trendWord.findMany({
    orderBy: { occurrences: "desc" },
    take: limit,
  });
  if (words.length === 0) return null;

  return (
    "直近、恋愛ジャンルの投稿でよく使われているハッシュタグ・言葉です" +
    "(無理に使う必要はありません。自然に絡められそうな場合だけ使ってください): " +
    words.map((w) => w.word).join("、")
  );
}
