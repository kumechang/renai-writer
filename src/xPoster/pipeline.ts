import type { Article, Draft } from "@prisma/client";
import { prisma } from "../db/client";
import { loadXPosterConfig, type XPosterConfig } from "./config";
import { generatePost } from "./generatePost";
import { generateStandalonePost } from "./generateStandalonePost";
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

// 単発投稿(記事に紐づかない投稿)のセルフチェックでは、記事本文の代わりにこの説明文を渡す。
const STANDALONE_SUBJECT_LABEL = "(単発投稿・特定の記事に紐づかない一般的な恋愛系の投稿)";

// 宣伝可能な記事が無い場合、selectArticleForPostが投げるエラーメッセージの一部
// (これに一致する場合のみ単発投稿へフォールバックする)。
const NO_ARTICLE_AVAILABLE_MARKER = "宣伝可能な記事が見つかりませんでした";

export interface GenerateXPostOptions {
  // 明示的に記事を指定する場合のみ渡す。省略時はまだ宣伝していない完成記事から自動で選ぶ
  // (「毎回投稿を考えるときに完成記事の中からネタを拾ってほしい」という運用に対応するため)。
  articleId?: string;
  articleUrl?: string;
}

export interface GenerateXPostResult {
  xPostId: string;
  // 記事に紐づかない単発投稿の場合はnull。
  articleId: string | null;
  articleTitle: string | null;
  finalText: string;
  score: number;
  pass: boolean;
  status: string;
  githubIssueUrl: string | null;
}

type Target = { kind: "article"; article: Article; draft: Draft } | { kind: "standalone" };

// 記事(Article)を紹介する投稿、または記事に紐づかない単発投稿を1件作るパイプライン全体の
// 統括役。対象選定(未指定なら自動選択/確率で単発投稿) → 本文生成 → セルフチェック(文字数
// 超過なら規定回数までやり直す) → DB保存 → 承認issue作成、の順に実行し、最後にautoモードなら
// その場で投稿まで行う(amazon-sentaku-shiageのgenerateCandidate.tsと同じ構成)。
export async function generateXPost(options: GenerateXPostOptions = {}): Promise<GenerateXPostResult> {
  const config = loadXPosterConfig();
  const target = await resolveTarget(options, config);

  const repo = parseGithubRepository();
  if (!repo) {
    throw new Error(
      "GITHUB_REPOSITORY(owner/repo形式)が設定されていません。承認issueの作成先が分からないため中断します。"
    );
  }

  const generate = (): Promise<string> =>
    target.kind === "article"
      ? generatePost(config.claudeModel, {
          articleId: target.article.id,
          articleTitle: target.article.title,
          articleContent: target.draft.content,
          articleUrl: options.articleUrl,
          charLimit: config.xCharLimit,
          recentFeedbackWindow: config.recentFeedbackWindow,
          recentPostsForVarietyWindow: config.recentPostsForVarietyWindow,
        })
      : generateStandalonePost(config.claudeModel, {
          charLimit: config.xCharLimit,
          recentFeedbackWindow: config.recentFeedbackWindow,
          recentPostsForVarietyWindow: config.recentPostsForVarietyWindow,
        });

  const runSelfCheckFor = (generatedText: string): Promise<{ raw: string; data: SelfCheckResult }> =>
    selfCheckPost(config.claudeModel, {
      generatedPost: generatedText,
      articleTitle: target.kind === "article" ? target.article.title : STANDALONE_SUBJECT_LABEL,
      articleContent: target.kind === "article" ? target.draft.content : "",
      charLimit: config.xCharLimit,
      passThreshold: config.selfCheckPassThreshold,
    });

  let generatedText = await generate();
  let selfCheck = await runSelfCheckFor(generatedText);
  let finalText = selfCheck.data.final_post;
  let weightedLength = getWeightedLength(finalText);

  // 文字数超過は投稿時にエラーになるため、承認issueを作る前に検知し、規定回数までやり直す。
  for (
    let attempt = 1;
    weightedLength > config.xCharLimit && attempt <= config.maxGenerateRetries;
    attempt++
  ) {
    generatedText = await generate();
    selfCheck = await runSelfCheckFor(generatedText);
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

  const articleId = target.kind === "article" ? target.article.id : null;
  const articleTitle = target.kind === "article" ? target.article.title : null;
  const draftId = target.kind === "article" ? target.draft.id : null;

  const xPost = await prisma.xPost.create({
    data: {
      articleId,
      draftId,
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
      articleId,
      articleTitle,
      finalText,
      score: selfCheck.data.score,
      pass: selfCheck.data.pass,
      status: xPost.status,
      githubIssueUrl: null,
    };
  }

  const originSession = articleId ? await prisma.issueSession.findFirst({ where: { articleId } }) : null;

  const issue = await createXPostApprovalIssue({
    articleTitle,
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
      articleId,
      articleTitle,
      finalText,
      score: selfCheck.data.score,
      pass: selfCheck.data.pass,
      status: posted.status,
      githubIssueUrl: posted.githubIssueUrl,
    };
  }

  return {
    xPostId: updated.id,
    articleId,
    articleTitle,
    finalText,
    score: selfCheck.data.score,
    pass: selfCheck.data.pass,
    status: updated.status,
    githubIssueUrl: updated.githubIssueUrl,
  };
}

// 今回の投稿対象を決める。--issueで明示指定された場合はそれを必ず使う(見つからなければ
// エラー)。自動選択の場合はstandalonePostRatioの確率で単発投稿にし、それ以外は記事を
// 選ぶ。ただし宣伝可能な記事が1件も無い場合は、確率に関わらず単発投稿にフォールバックする
// (「記事の在庫が無くても恋愛系の投稿を続けてほしい」という運用要望に対応)。
async function resolveTarget(options: GenerateXPostOptions, config: XPosterConfig): Promise<Target> {
  if (options.articleId) {
    const article = await requireArticle(options.articleId);
    const draft = await requireDraft(article.id);
    return { kind: "article", article, draft };
  }

  const wantsStandalone = Math.random() < config.standalonePostRatio;
  if (!wantsStandalone) {
    try {
      const article = await selectArticleForPost(config.repromotionCooldownDays);
      const draft = await requireDraft(article.id);
      return { kind: "article", article, draft };
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes(NO_ARTICLE_AVAILABLE_MARKER)) {
        throw error;
      }
    }
  }

  return { kind: "standalone" };
}

async function requireArticle(articleId: string): Promise<Article> {
  const article = await prisma.article.findUnique({ where: { id: articleId } });
  if (!article) throw new Error(`article not found: ${articleId}`);
  if (!PROMOTABLE_ARTICLE_STATUSES.includes(article.status)) {
    throw new Error(
      `この記事はXでの告知対象のステータスではありません(status=${article.status}, 対象: ${PROMOTABLE_ARTICLE_STATUSES.join("/")})`
    );
  }
  return article;
}

async function requireDraft(articleId: string): Promise<Draft> {
  const draft = await prisma.draft.findFirst({
    where: { articleId },
    orderBy: { revisionNumber: "desc" },
  });
  if (!draft) throw new Error(`記事にまだ原稿がありません(articleId=${articleId})`);
  return draft;
}
