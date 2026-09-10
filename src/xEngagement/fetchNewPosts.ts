import { prisma } from "../db/client";
import { getXClient } from "../xPoster/xClient";
import { hasXCredentials } from "../xPoster/env";
import { parseGithubRepository } from "../xPoster/env";
import { syncWatchedAccounts } from "./syncWatchedAccounts";
import { loadXEngagementConfig } from "./config";
import { createReplyPromptIssue } from "./promptIssue";

// 直近検索で1回に取得する最大件数。X APIの読み取りは返ってきた件数に応じて課金される
// (2026年時点で投稿1件あたり約$0.005、100件返れば1回$0.50)ため、上限いっぱいの100件に
// せず控えめにする。ウォッチ対象(現状11アカウント)がチェック間隔(3時間おき)の間に
// 合計でこれを超える件数を新規投稿することは想定していない。超えた場合、超過分はその回は
// 取得できず次回以降の検索で拾われる(投稿自体を見逃すわけではない)。
const SEARCH_MAX_RESULTS = 20;

// 検索クエリ("from:a OR from:b OR ...")の文字数上限の目安(X API Basicティアの
// クエリ長上限512文字に対して安全マージンを取った値)。ウォッチ対象アカウントが
// 極端に多い場合はこれを超えるが、その場合はAPIがエラーを返すため、
// ログで気づけるようにするだけに留める(件数を絞る運用上の対処が必要になる)。
const SAFE_QUERY_LENGTH = 480;

export interface FetchNewPostsResult {
  accountsChecked: number;
  newPosts: number;
  issuesCreated: number;
}

// ウォッチ対象アカウント(config/x-watch-accounts.jsonと同期済みのWatchedAccount)全員の
// 直近の投稿(リツイート・リプライを除く本人の投稿のみ)を、X APIの投稿検索
// (`from:user1 OR from:user2 OR ...`)で1回のAPI呼び出しにまとめて取得し、まだ保存して
// いないものをWatchedPostとして新規作成する。アカウントを1人ずつ呼び出す方式
// (userTimeline)だとアカウント数に比例してAPI呼び出し数が増えてしまうため、
// discoverAccounts.tsと同じ投稿検索エンドポイントをまとめて使う方式にしている。
//
// 新着投稿を見つけ次第、件数を気にせずGitHub issue(Claude.aiのチャットに貼り付ける
// リプライ検討プロンプト)を作る。Claude APIは呼ばないため、issueを何件作っても
// API使用量は増えない(src/xEngagement/promptIssue.ts)。
// X APIキー未設定の場合は何もせず終える(ドライラン運用中でもエラーで落とさないため)。
export async function fetchNewPosts(): Promise<FetchNewPostsResult> {
  const accounts = await syncWatchedAccounts();
  const activeAccounts = accounts.filter((a) => a.active);

  if (!hasXCredentials()) {
    console.warn("[x-engagement] X API credentials not configured, skipping fetch");
    return { accountsChecked: 0, newPosts: 0, issuesCreated: 0 };
  }
  if (activeAccounts.length === 0) {
    return { accountsChecked: 0, newPosts: 0, issuesCreated: 0 };
  }

  const accountByUsername = new Map(activeAccounts.map((a) => [a.username.toLowerCase(), a]));

  const fromClause = activeAccounts.map((a) => `from:${a.username}`).join(" OR ");
  const query = `(${fromClause}) -is:retweet -is:reply`;
  if (query.length > SAFE_QUERY_LENGTH) {
    console.warn(
      `[x-engagement] search query is ${query.length} chars, may exceed the API's query length limit ` +
        `(consider trimming config/x-watch-accounts.json if this starts failing)`
    );
  }

  const result = await getXClient().v2.search(query, {
    max_results: SEARCH_MAX_RESULTS,
    expansions: ["author_id"],
    "tweet.fields": ["created_at"],
    "user.fields": ["username"],
  });

  const config = loadXEngagementConfig();
  const repo = parseGithubRepository();

  let newPosts = 0;
  let issuesCreated = 0;
  for (const tweet of result.tweets) {
    const author = result.includes.author(tweet);
    const account = author ? accountByUsername.get(author.username.toLowerCase()) : undefined;
    if (!account) continue;

    const existing = await prisma.watchedPost.findUnique({ where: { tweetId: tweet.id } });
    if (existing) continue;

    const post = await prisma.watchedPost.create({
      data: {
        watchedAccountId: account.id,
        tweetId: tweet.id,
        text: tweet.text,
        postedAt: tweet.created_at ? new Date(tweet.created_at) : new Date(),
      },
    });
    newPosts += 1;

    if (repo && process.env.GITHUB_TOKEN) {
      const postUrl = `https://x.com/${account.username}/status/${tweet.id}`;
      const issue = await createReplyPromptIssue(repo.owner, repo.repo, {
        authorUsername: account.username,
        postText: tweet.text,
        postUrl,
        charLimit: config.xCharLimit,
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

  return { accountsChecked: activeAccounts.length, newPosts, issuesCreated };
}
