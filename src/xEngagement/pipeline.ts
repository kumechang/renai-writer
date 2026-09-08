import type { WatchedPost } from "@prisma/client";
import { prisma } from "../db/client";
import { loadXEngagementConfig, type XEngagementConfig } from "./config";
import { generateReply } from "./generateReply";
import { selfCheckReply, type EngagementReplySelfCheckResult } from "./selfCheckReply";
import { getWeightedLength } from "../xPoster/tweetLength";
import { shortenPost } from "../xPoster/shortenPost";
import { createEngagementApprovalIssue } from "./approvalIssue";
import { finalizeEngagementReply } from "./finalizeReply";
import { parseGithubRepository } from "../xPoster/env";
import { selectWatchedPost, skipStalePosts } from "./selectWatchedPost";
import { shouldReplyNow } from "./shouldReplyNow";

const MAX_SHORTEN_ATTEMPTS = 3;

export interface GenerateEngagementReplyResult {
  replyId: string;
  authorUsername: string;
  postText: string;
  finalText: string;
  score: number;
  pass: boolean;
  status: string;
  githubIssueUrl: string | null;
}

// ウォッチ対象アカウントの新着投稿(WatchedPost, status: "new")を1件選び、リプライ文を
// 生成 → セルフチェック(文字数超過ならやり直し) → DB保存 → 承認issue作成、まで行う。
// autoモードかつ合格ならその場で投稿まで行う(src/xPoster/pipeline.tsと同じ構成)。
// 対象になる投稿が無い場合はnullを返す(定期実行では想定内の状態のため)。
export async function generateEngagementReply(now: Date = new Date()): Promise<GenerateEngagementReplyResult | null> {
  const config = loadXEngagementConfig();

  const repo = parseGithubRepository();
  if (!repo) {
    throw new Error(
      "GITHUB_REPOSITORY(owner/repo形式)が設定されていません。承認issueの作成先が分からないため中断します。"
    );
  }

  await skipStalePosts(config, now);

  if (!(await shouldReplyNow(config, now))) {
    return null;
  }

  const post = await selectWatchedPost(config, now);
  if (!post) return null;

  // 選んだ時点で"processing"に進め、次回実行でのstatus:"new"クエリに再度引っかからない
  // ようにする(EngagementReplyはwatchedPostIdがユニークなため、同じ投稿を二重に
  // 選んでしまうとDB制約違反になる)。
  await prisma.watchedPost.update({ where: { id: post.id }, data: { status: "processing" } });

  const account = await prisma.watchedAccount.findUniqueOrThrow({ where: { id: post.watchedAccountId } });

  return generateReplyForPost(config, repo, post, account.username);
}

async function generateReplyForPost(
  config: XEngagementConfig,
  repo: { owner: string; repo: string },
  post: WatchedPost,
  authorUsername: string
): Promise<GenerateEngagementReplyResult> {
  const generate = (): Promise<string> =>
    generateReply(config.claudeModel, {
      authorUsername,
      postText: post.text,
      charLimit: config.xCharLimit,
      recentFeedbackWindow: config.recentFeedbackWindow,
    });

  const runSelfCheckFor = (
    replyText: string
  ): Promise<{ raw: string; data: EngagementReplySelfCheckResult }> =>
    selfCheckReply(config.claudeModel, {
      authorUsername,
      postText: post.text,
      reply: replyText,
      charLimit: config.xCharLimit,
      passThreshold: config.selfCheckPassThreshold,
    });

  let generatedText = await generate();
  let selfCheck = await runSelfCheckFor(generatedText);
  let finalText = selfCheck.data.final_reply;
  let weightedLength = getWeightedLength(finalText);

  for (
    let attempt = 1;
    weightedLength > config.xCharLimit && attempt <= config.maxGenerateRetries;
    attempt++
  ) {
    generatedText = await generate();
    selfCheck = await runSelfCheckFor(generatedText);
    finalText = selfCheck.data.final_reply;
    weightedLength = getWeightedLength(finalText);
  }

  for (
    let attempt = 1;
    weightedLength > config.xCharLimit && attempt <= MAX_SHORTEN_ATTEMPTS;
    attempt++
  ) {
    finalText = await shortenPost(config.claudeModel, finalText, config.xCharLimit, attempt);
    weightedLength = getWeightedLength(finalText);
  }

  if (weightedLength > config.xCharLimit) {
    throw new Error(
      `生成したリプライが文字数上限を超過したままです(規定回数のやり直し・短縮後も解消せず): ${weightedLength} > ${config.xCharLimit}`
    );
  }

  const reply = await prisma.engagementReply.create({
    data: {
      watchedPostId: post.id,
      generatedText,
      finalText,
      selfCheckJson: JSON.stringify(selfCheck.data),
      status: "pending_approval",
      githubIssueOwner: repo.owner,
      githubIssueRepo: repo.repo,
    },
  });

  if (!process.env.GITHUB_TOKEN) {
    return {
      replyId: reply.id,
      authorUsername,
      postText: post.text,
      finalText,
      score: selfCheck.data.score,
      pass: selfCheck.data.pass,
      status: reply.status,
      githubIssueUrl: null,
    };
  }

  const postUrl = `https://x.com/${authorUsername}/status/${post.tweetId}`;
  const issue = await createEngagementApprovalIssue({
    authorUsername,
    postText: post.text,
    postUrl,
    finalText,
    score: selfCheck.data.score,
    pass: selfCheck.data.pass,
    problems: selfCheck.data.problems,
    improvements: selfCheck.data.improvements,
    repoOwner: repo.owner,
    repoName: repo.repo,
  });

  const updated = await prisma.engagementReply.update({
    where: { id: reply.id },
    data: { githubIssueNumber: issue.number, githubIssueUrl: issue.url },
    include: { watchedPost: true },
  });

  // autoモードでも、セルフチェック不合格(pass=false)の場合は必ず人の承認待ちに倒す
  // (自動投稿がセルフチェックをバイパスすることは無いようにする安全策)。
  if (config.approvalMode === "auto" && selfCheck.data.pass) {
    await finalizeEngagementReply(updated);
    const posted = await prisma.engagementReply.findUniqueOrThrow({ where: { id: reply.id } });
    return {
      replyId: posted.id,
      authorUsername,
      postText: post.text,
      finalText,
      score: selfCheck.data.score,
      pass: selfCheck.data.pass,
      status: posted.status,
      githubIssueUrl: posted.githubIssueUrl,
    };
  }

  return {
    replyId: updated.id,
    authorUsername,
    postText: post.text,
    finalText,
    score: selfCheck.data.score,
    pass: selfCheck.data.pass,
    status: updated.status,
    githubIssueUrl: updated.githubIssueUrl,
  };
}
