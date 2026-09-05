import { prisma } from "../db/client";
import { loadXPosterConfig } from "./config";
import { generatePost } from "./generatePost";
import { selfCheckPost, type SelfCheckResult } from "./selfCheckPost";
import { getWeightedLength } from "./tweetLength";
import { shortenPost } from "./shortenPost";
import { createXPostApprovalIssue } from "./approvalIssue";
import { finalizeXPost } from "./finalizePost";
import { parseGithubRepository } from "./env";
import { selectArticleForPost, PROMOTABLE_ARTICLE_STATUSES } from "./selectArticle";

// 生成+セルフチェックのやり直し(config.maxGenerateRetries)でも文字数超過が
// 解消しない場合の最終手段として、専用の短縮パスを最大この回数まで試す
// (amazon-sentaku-shiageのgenerateCandidate.tsのMAX_SHORTEN_ATTEMPTSと同じ)。
const MAX_SHORTEN_ATTEMPTS = 3;

export interface GenerateXPostOptions {
  // 明示的に記事を指定する場合のみ渡す。省略時はまだ宣伝していない完成記事から自動で選ぶ
  // (「毎回投稿を考えるときに完成記事の中からネタを拾ってほしい」という運用に対応するため)。
  articleId?: string;
  articleUrl?: string;
}

export interface GenerateXPostResult {
  xPostId: string;
  articleId: string;
  articleTitle: string;
  finalText: string;
  score: number;
  pass: boolean;
  status: string;
  githubIssueUrl: string | null;
}

// 記事(Article)を紹介するX投稿を1件作るパイプライン全体の統括役。
// 記事選択(未指定なら自動選択) → 本文生成 → セルフチェック(文字数超過なら規定回数まで
// やり直す) → DB保存 → 承認issue作成、の順に実行し、最後にautoモードならその場で投稿まで行う
// (amazon-sentaku-shiageのgenerateCandidate.tsと同じ構成)。
export async function generateXPost(options: GenerateXPostOptions = {}): Promise<GenerateXPostResult> {
  const config = loadXPosterConfig();

  const article = options.articleId
    ? await requireArticle(options.articleId)
    : await selectArticleForPost(config.repromotionCooldownDays);

  const draft = await prisma.draft.findFirst({
    where: { articleId: article.id },
    orderBy: { revisionNumber: "desc" },
  });
  if (!draft) throw new Error(`記事にまだ原稿がありません(articleId=${article.id})`);

  const repo = parseGithubRepository();
  if (!repo) {
    throw new Error(
      "GITHUB_REPOSITORY(owner/repo形式)が設定されていません。承認issueの作成先が分からないため中断します。"
    );
  }

  let generatedText = await generatePost(config.claudeModel, {
    articleTitle: article.title,
    articleContent: draft.content,
    articleUrl: options.articleUrl,
    charLimit: config.xCharLimit,
    recentFeedbackWindow: config.recentFeedbackWindow,
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
      charLimit: config.xCharLimit,
      recentFeedbackWindow: config.recentFeedbackWindow,
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

  // 生成のやり直しを重ねても文字数超過が解消しない場合の最終手段として、
  // 「今の文章を明示的に縮める」専用パスを収まるまで複数回かける
  // (ゼロから再生成するだけでは短くなる保証がなく、頭打ちになることがあるため)。
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
      `生成した投稿が文字数上限を超過したままです(規定回数のやり直し・短縮後も解消せず): ${weightedLength} > ${config.xCharLimit}`
    );
  }

  const xPost = await prisma.xPost.create({
    data: {
      articleId: article.id,
      draftId: draft.id,
      articleUrl: options.articleUrl ?? null,
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
      xPostId: xPost.id,
      articleId: article.id,
      articleTitle: article.title,
      finalText,
      score: selfCheck.data.score,
      pass: selfCheck.data.pass,
      status: xPost.status,
      githubIssueUrl: null,
    };
  }

  const originSession = await prisma.issueSession.findFirst({ where: { articleId: article.id } });

  const issue = await createXPostApprovalIssue({
    articleTitle: article.title,
    finalText,
    selfCheck: selfCheck.data,
    repoOwner: repo.owner,
    repoName: repo.repo,
    sourceIssueNumber: originSession?.issueNumber ?? null,
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
      articleId: article.id,
      articleTitle: article.title,
      finalText,
      score: selfCheck.data.score,
      pass: selfCheck.data.pass,
      status: posted.status,
      githubIssueUrl: posted.githubIssueUrl,
    };
  }

  return {
    xPostId: updated.id,
    articleId: article.id,
    articleTitle: article.title,
    finalText,
    score: selfCheck.data.score,
    pass: selfCheck.data.pass,
    status: updated.status,
    githubIssueUrl: updated.githubIssueUrl,
  };
}

async function requireArticle(articleId: string) {
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) throw new Error(`article not found: ${articleId}`);
  if (!PROMOTABLE_ARTICLE_STATUSES.includes(article.status)) {
    throw new Error(
      `この記事はXでの告知対象のステータスではありません(status=${article.status}, 対象: ${PROMOTABLE_ARTICLE_STATUSES.join("/")})`
    );
  }
  return article;
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
