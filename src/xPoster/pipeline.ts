import { prisma } from "../db/client";
import { loadXPosterConfig } from "./config";
import { generatePost } from "./generatePost";
import { selfCheckPost, type SelfCheckResult } from "./selfCheckPost";
import { getWeightedLength } from "./tweetLength";
import { createXPostApprovalIssue } from "./approvalIssue";
import { finalizeXPost } from "./finalizePost";

export interface SourceIssueRef {
  owner: string;
  repo: string;
  number: number;
}

// Xで告知してよい記事のステータス(条件付き成立を含む。要人間確認の記事は対象外)。
const PROMOTABLE_STATUSES = ["accepted", "accepted_with_reservation"];

export interface GenerateXPostOptions {
  articleUrl?: string;
}

export interface GenerateXPostResult {
  xPostId: string;
  finalText: string;
  score: number;
  pass: boolean;
  status: string;
  githubIssueUrl: string | null;
}

// 記事(Article)を紹介するX投稿を1件作るパイプライン全体の統括役。
// 本文生成 → セルフチェック(文字数超過なら規定回数までやり直す) → DB保存 → 承認issue作成、
// の順に実行し、最後にautoモードならその場で投稿まで行う
// (amazon-sentaku-shiageのgenerateCandidate.tsと同じ構成)。
export async function generateXPostForArticle(
  articleId: string,
  sourceIssue: SourceIssueRef,
  options: GenerateXPostOptions = {}
): Promise<GenerateXPostResult> {
  const config = loadXPosterConfig();

  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) throw new Error(`article not found: ${articleId}`);
  if (!PROMOTABLE_STATUSES.includes(article.status)) {
    throw new Error(
      `この記事はXでの告知対象のステータスではありません(status=${article.status}, 対象: ${PROMOTABLE_STATUSES.join("/")})`
    );
  }

  const draft = await prisma.draft.findFirst({
    where: { articleId },
    orderBy: { revisionNumber: "desc" },
  });
  if (!draft) throw new Error(`記事にまだ原稿がありません(articleId=${articleId})`);

  let generatedText = await generatePost(config.claudeModel, {
    articleTitle: article.title,
    articleContent: draft.content,
    articleUrl: options.articleUrl,
  });

  let selfCheck = await runSelfCheck(config.claudeModel, config.selfCheckPassThreshold, {
    generatedPost: generatedText,
    articleTitle: article.title,
    articleContent: draft.content,
    charLimit: config.xCharLimit,
  });
  let finalText = selfCheck.data.final_post;
  let weightedLength = getWeightedLength(finalText);

  // 文字数超過は投稿時にエラーになるため、承認issueを作る前に検知し、規定回数までやり直す。
  for (
    let attempt = 1;
    weightedLength > config.xCharLimit && attempt <= config.maxGenerateRetries;
    attempt++
  ) {
    generatedText = await generatePost(config.claudeModel, {
      articleTitle: article.title,
      articleContent: draft.content,
      articleUrl: options.articleUrl,
    });
    selfCheck = await runSelfCheck(config.claudeModel, config.selfCheckPassThreshold, {
      generatedPost: generatedText,
      articleTitle: article.title,
      articleContent: draft.content,
      charLimit: config.xCharLimit,
    });
    finalText = selfCheck.data.final_post;
    weightedLength = getWeightedLength(finalText);
  }

  if (weightedLength > config.xCharLimit) {
    throw new Error(
      `生成した投稿が文字数上限を超過したままです(規定回数のやり直し後も解消せず): ${weightedLength} > ${config.xCharLimit}`
    );
  }

  const xPost = await prisma.xPost.create({
    data: {
      articleId,
      draftId: draft.id,
      articleUrl: options.articleUrl ?? null,
      generatedText,
      finalText,
      selfCheckJson: JSON.stringify(selfCheck.data),
      status: "pending_approval",
      githubIssueOwner: sourceIssue.owner,
      githubIssueRepo: sourceIssue.repo,
    },
  });

  if (!process.env.GITHUB_TOKEN) {
    return {
      xPostId: xPost.id,
      finalText,
      score: selfCheck.data.score,
      pass: selfCheck.data.pass,
      status: xPost.status,
      githubIssueUrl: null,
    };
  }

  const issue = await createXPostApprovalIssue({
    articleTitle: article.title,
    finalText,
    selfCheck: selfCheck.data,
    sourceIssueOwner: sourceIssue.owner,
    sourceIssueRepo: sourceIssue.repo,
    sourceIssueNumber: sourceIssue.number,
  });

  const updated = await prisma.xPost.update({
    where: { id: xPost.id },
    data: { githubIssueNumber: issue.number, githubIssueUrl: issue.url },
  });

  // autoモードでも、セルフチェック不合格(pass=false)の場合は必ず人の承認待ちに倒す
  // (自動投稿がセルフチェックをバイパスすることは無いようにする安全策)。
  if (config.approvalMode === "auto" && selfCheck.data.pass) {
    await finalizeXPost(updated);
    const posted = await prisma.xPost.findUniqueOrThrow({ where: { id: xPost.id } });
    return {
      xPostId: posted.id,
      finalText,
      score: selfCheck.data.score,
      pass: selfCheck.data.pass,
      status: posted.status,
      githubIssueUrl: posted.githubIssueUrl,
    };
  }

  return {
    xPostId: updated.id,
    finalText,
    score: selfCheck.data.score,
    pass: selfCheck.data.pass,
    status: updated.status,
    githubIssueUrl: updated.githubIssueUrl,
  };
}

interface RunSelfCheckInput {
  generatedPost: string;
  articleTitle: string;
  articleContent: string;
  charLimit: number;
}

async function runSelfCheck(
  model: string,
  passThreshold: number,
  input: RunSelfCheckInput
): Promise<{ raw: string; data: SelfCheckResult }> {
  return selfCheckPost(model, { ...input, passThreshold });
}
