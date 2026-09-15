import { prisma } from "../db/client";
import { getXClient } from "../xPoster/xClient";
import { hasXCredentials } from "../xPoster/env";
import { parseGithubRepository } from "../xPoster/env";
import { loadXEngagementConfig } from "./config";
import { loadXEngagementSearchConfig } from "./searchConfig";
import { createReplyPromptIssue } from "./promptIssue";

export interface FindReplyCandidatesResult {
  fetched: number;
  qualifying: number;
  issuesCreated: number;
}

export interface RawTweetEntry {
  id: string;
  text: string;
  authorId?: string;
  impressionCount: number;
  postedAt: Date;
}

export interface QualifyingTweet {
  id: string;
  text: string;
  authorId: string;
  impressionCount: number;
  postedAt: Date;
}

// 検索結果から、インプレッション数がしきい値を超えている投稿だけを、インプレッション数の
// 多い順に、同一投稿者からは1件だけ(最もインプレッション数が多いもの)に絞り込む純粋関数。
// author_idが取れない投稿(まれ)は候補にしない。
export function selectQualifyingTweets(
  entries: RawTweetEntry[],
  impressionThreshold: number
): QualifyingTweet[] {
  const aboveThreshold = entries
    .filter((entry): entry is RawTweetEntry & { authorId: string } =>
      Boolean(entry.authorId) && entry.impressionCount >= impressionThreshold
    )
    .sort((a, b) => b.impressionCount - a.impressionCount);

  const seenAuthors = new Set<string>();
  const qualifying: QualifyingTweet[] = [];
  for (const entry of aboveThreshold) {
    if (seenAuthors.has(entry.authorId)) continue;
    seenAuthors.add(entry.authorId);
    qualifying.push(entry);
  }
  return qualifying;
}

// 特定アカウントの監視ではなく、ジャンル横断のキーワード検索(1回のAPI呼び出しのみ、
// ユーザー情報は取得しない)で直近の投稿を取得し、インプレッション数が
// config/x-engagement-search.jsonのしきい値を超えているものだけをリプライ候補として
// GitHub issue化する。
//
// ユーザー名を解決すると1ユーザーあたり課金される(2026年時点で約$0.010)ため、あえて
// 取得しない。投稿本体の読み取りのみ(1件あたり約$0.005)なので、1回の実行コストは
// maxResults件 × $0.005で確定する(config既定値10件なら$0.05)。投稿へのリンクは
// `https://x.com/i/web/status/{tweetId}` 形式(ユーザー名を問わずツイートIDだけで
// 正しい投稿に遷移する)にし、誰の投稿かは運用者がリンクを開いて直接確認する。
//
// 同じ投稿者から複数件が条件を満たした場合は、インプレッション数が最も多い1件のみを採用する
// (「1ユーザーあたり1件まで」という運用方針)。
export async function findReplyCandidates(): Promise<FindReplyCandidatesResult> {
  if (!hasXCredentials()) {
    console.warn("[x-engagement] X API credentials not configured, skipping fetch");
    return { fetched: 0, qualifying: 0, issuesCreated: 0 };
  }

  const searchConfig = loadXEngagementSearchConfig();
  const result = await getXClient().v2.search(searchConfig.searchQuery, {
    max_results: searchConfig.maxResults,
    "tweet.fields": ["created_at", "public_metrics"],
  });

  const rawEntries: RawTweetEntry[] = result.tweets.map((tweet) => ({
    id: tweet.id,
    text: tweet.text,
    authorId: tweet.author_id,
    impressionCount: tweet.public_metrics?.impression_count ?? 0,
    postedAt: tweet.created_at ? new Date(tweet.created_at) : new Date(),
  }));

  const qualifying = selectQualifyingTweets(rawEntries, searchConfig.impressionThreshold);

  const engagementConfig = loadXEngagementConfig();
  const repo = parseGithubRepository();

  let issuesCreated = 0;
  for (const tweet of qualifying) {
    const existing = await prisma.watchedPost.findUnique({ where: { tweetId: tweet.id } });
    if (existing) continue;

    const postUrl = `https://x.com/i/web/status/${tweet.id}`;
    const post = await prisma.watchedPost.create({
      data: {
        tweetId: tweet.id,
        text: tweet.text,
        postedAt: tweet.postedAt,
        authorId: tweet.authorId,
        impressionCount: tweet.impressionCount,
        postUrl,
      },
    });

    if (repo && process.env.GITHUB_TOKEN) {
      const issue = await createReplyPromptIssue(repo.owner, repo.repo, {
        postText: tweet.text,
        postUrl,
        impressionCount: tweet.impressionCount,
        charLimit: engagementConfig.xCharLimit,
      });
      await prisma.watchedPost.update({
        where: { id: post.id },
        data: {
          status: "prompted",
          githubIssueOwner: repo.owner,
          githubIssueRepo: repo.repo,
          githubIssueNumber: issue.number,
          githubIssueUrl: issue.url,
        },
      });
      issuesCreated += 1;
    }
  }

  return { fetched: result.tweets.length, qualifying: qualifying.length, issuesCreated };
}
