import type { Article, Draft } from "@prisma/client";
import { prisma } from "../db/client";
import { loadXPosterConfig, type XPosterConfig } from "./config";
import { generatePost } from "./generatePost";
import { generateStandalonePost } from "./generateStandalonePost";
import { generateUrlThreadPost } from "./generateUrlThreadPost";
import { selfCheckPost, type SelfCheckResult } from "./selfCheckPost";
import { selfCheckUrlThreadPost } from "./selfCheckUrlThreadPost";
import { selfCheckStandalonePost } from "./selfCheckStandalonePost";
import { getWeightedLength } from "./tweetLength";
import { shortenPost } from "./shortenPost";
import { createXPostApprovalIssue } from "./approvalIssue";
import { finalizeXPost } from "./finalizePost";
import { parseGithubRepository } from "./env";
import { selectArticleForPost, PROMOTABLE_ARTICLE_STATUSES } from "./selectArticle";
import { findOriginSession, isArticlePublished } from "./articlePublication";
import { hasReachedDailyUrlPostLimit, findUrlThreadCandidate } from "./urlThreadCandidate";

// 生成+セルフチェックのやり直し(config.maxGenerateRetries)でも文字数超過が
// 解消しない場合の最終手段として、専用の短縮パスを最大この回数まで試す
// (amazon-sentaku-shiageのgenerateCandidate.tsのMAX_SHORTEN_ATTEMPTSと同じ)。
const MAX_SHORTEN_ATTEMPTS = 3;

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
  // 記事URL付きの2ツイート構成(スレッド)投稿の場合のみ設定される、2件目(核心+記事URL、
  // 1件目への返信)の本文。通常の投稿ではnull。
  replyText: string | null;
  score: number;
  pass: boolean;
  status: string;
  githubIssueUrl: string | null;
}

type Target = { kind: "article"; article: Article; draft: Draft } | { kind: "standalone" };

type Repo = { owner: string; repo: string };

interface SelfCheckData {
  score: number;
  pass: boolean;
  problems: string[];
  improvements: string[];
}

interface PersistAndDispatchInput {
  articleId: string | null;
  articleTitle: string | null;
  draftId: string | null;
  articleUrl: string | null;
  generatedText: string;
  finalText: string;
  replyText: string | null;
  selfCheckJson: string;
  selfCheckData: SelfCheckData;
  repo: Repo;
  sourceIssueNumber: number | null;
  approvalMode: XPosterConfig["approvalMode"];
}

// 記事(Article)を紹介する投稿、または記事に紐づかない単発投稿を1件作るパイプライン全体の
// 統括役。対象選定(未指定なら自動選択/確率で単発投稿) → 本文生成 → セルフチェック(文字数
// 超過なら規定回数までやり直す) → DB保存 → 承認issue作成、の順に実行し、最後にautoモードなら
// その場で投稿まで行う(amazon-sentaku-shiageのgenerateCandidate.tsと同じ構成)。
//
// ただし記事を明示指定していない自動選択の場合、まず記事URL付きの2ツイート構成スレッド
// (公開済み記事のissueに貼られたURLを使う投稿)を1日urlPostsPerDay件まで優先的に試す。
// 対象が見つからなければ通常のフローにフォールバックする。単発投稿(記事に紐づかない投稿)は
// 自分でコメント(返信)を付けた投稿の方がインプレッションが伸びる傾向が見られたため、
// 常に「問題提起→回答」の2ツイート構成スレッドで作る(tryGenerateStandaloneThreadPost)。
export async function generateXPost(options: GenerateXPostOptions = {}): Promise<GenerateXPostResult> {
  const config = loadXPosterConfig();

  const repo = parseGithubRepository();
  if (!repo) {
    throw new Error(
      "GITHUB_REPOSITORY(owner/repo形式)が設定されていません。承認issueの作成先が分からないため中断します。"
    );
  }

  if (!options.articleId) {
    const urlThreadResult = await tryGenerateUrlThreadPost(config, repo);
    if (urlThreadResult) return urlThreadResult;
  }

  const target = await resolveTarget(options, config);

  if (target.kind === "standalone") {
    return generateStandaloneThreadPost(config, repo);
  }

  // 記事issueがオープン(=まだ他媒体に公開していない)かクローズ済み(=公開済み)かで
  // 生成方針を変える(「記事issueがオープンのうちは内容を匂わせる程度にしてほしい」
  // という運用要望に対応)。元issueが分からない・状態取得に失敗した場合は、内容を
  // 漏らさない安全側(未公開扱い)に倒す。
  const originSession = await findOriginSession(target.article.id);
  const published = await isArticlePublished(originSession);

  const generate = (): Promise<string> =>
    generatePost(config.claudeModel, {
      articleId: target.article.id,
      articleTitle: target.article.title,
      articleContent: target.draft.content,
      articleUrl: options.articleUrl,
      published,
      charLimit: config.xCharLimit,
      recentFeedbackWindow: config.recentFeedbackWindow,
      recentPostsForVarietyWindow: config.recentPostsForVarietyWindow,
      trendWordsLimit: config.trendWordsLimit,
    });

  const runSelfCheckFor = (generatedText: string): Promise<{ raw: string; data: SelfCheckResult }> =>
    selfCheckPost(config.claudeModel, {
      generatedPost: generatedText,
      articleTitle: target.article.title,
      articleContent: target.draft.content,
      published,
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

  return persistAndDispatch({
    articleId: target.article.id,
    articleTitle: target.article.title,
    draftId: target.draft.id,
    articleUrl: options.articleUrl ?? null,
    generatedText,
    finalText,
    replyText: null,
    selfCheckJson: JSON.stringify(selfCheck.data),
    selfCheckData: selfCheck.data,
    repo,
    sourceIssueNumber: originSession?.issueNumber ?? null,
    approvalMode: config.approvalMode,
  });
}

// 記事に紐づかない単発投稿を、hook(問題提起・あるある)→payoff(回答、1件目への返信)の
// 2ツイート構成スレッドで作る。自分でコメント(返信)を付けた投稿の方がインプレッションが
// 伸びる傾向が見られたため、記事URL付きスレッドと同じ構成を単発投稿にも採用している。
async function generateStandaloneThreadPost(config: XPosterConfig, repo: Repo): Promise<GenerateXPostResult> {
  const generate = () =>
    generateStandalonePost(config.claudeModel, {
      charLimit: config.xCharLimit,
      recentFeedbackWindow: config.recentFeedbackWindow,
      recentPostsForVarietyWindow: config.recentPostsForVarietyWindow,
      trendWordsLimit: config.trendWordsLimit,
    });

  const runSelfCheckFor = (hook: string, payoff: string) =>
    selfCheckStandalonePost(config.claudeModel, {
      hook,
      payoff,
      charLimit: config.xCharLimit,
      passThreshold: config.selfCheckPassThreshold,
    });

  let generated = await generate();
  let selfCheck = await runSelfCheckFor(generated.hook, generated.payoff);
  let finalHook = selfCheck.data.final_hook;
  let finalPayoff = selfCheck.data.final_payoff;
  let hookLength = getWeightedLength(finalHook);
  let payoffLength = getWeightedLength(finalPayoff);

  for (
    let attempt = 1;
    (hookLength > config.xCharLimit || payoffLength > config.xCharLimit) && attempt <= config.maxGenerateRetries;
    attempt++
  ) {
    generated = await generate();
    selfCheck = await runSelfCheckFor(generated.hook, generated.payoff);
    finalHook = selfCheck.data.final_hook;
    finalPayoff = selfCheck.data.final_payoff;
    hookLength = getWeightedLength(finalHook);
    payoffLength = getWeightedLength(finalPayoff);
  }

  // hookとpayoffは別ツイートなので、文字数超過の短縮もそれぞれ独立に行う。
  for (let attempt = 1; hookLength > config.xCharLimit && attempt <= MAX_SHORTEN_ATTEMPTS; attempt++) {
    finalHook = await shortenPost(config.claudeModel, finalHook, config.xCharLimit, attempt);
    hookLength = getWeightedLength(finalHook);
  }

  for (let attempt = 1; payoffLength > config.xCharLimit && attempt <= MAX_SHORTEN_ATTEMPTS; attempt++) {
    finalPayoff = await shortenPost(config.claudeModel, finalPayoff, config.xCharLimit, attempt);
    payoffLength = getWeightedLength(finalPayoff);
  }

  if (hookLength > config.xCharLimit || payoffLength > config.xCharLimit) {
    throw new Error(
      `単発投稿が文字数上限を超過したままです(規定回数のやり直し・短縮後も解消せず): hook=${hookLength}, payoff=${payoffLength} > ${config.xCharLimit}`
    );
  }

  return persistAndDispatch({
    articleId: null,
    articleTitle: null,
    draftId: null,
    articleUrl: null,
    generatedText: `${generated.hook}\n---\n${generated.payoff}`,
    finalText: finalHook,
    replyText: finalPayoff,
    selfCheckJson: JSON.stringify(selfCheck.data),
    selfCheckData: selfCheck.data,
    repo,
    sourceIssueNumber: null,
    approvalMode: config.approvalMode,
  });
}

// 記事URL付きの2ツイート構成スレッド(hook→core+URLへの返信)を1件作る。今日(JST)の
// 上限に達している、または対象になる記事(公開済み・最後のコメントにURLあり・処理中/
// クールダウン中でない)が無ければnullを返し、呼び出し元は通常フローにフォールバックする。
async function tryGenerateUrlThreadPost(
  config: XPosterConfig,
  repo: Repo
): Promise<GenerateXPostResult | null> {
  if (await hasReachedDailyUrlPostLimit(config.urlPostsPerDay)) return null;

  const candidate = await findUrlThreadCandidate(config.repromotionCooldownDays);
  if (!candidate) return null;

  const { article, draft, articleUrl } = candidate;

  const generate = () =>
    generateUrlThreadPost(config.claudeModel, {
      articleId: article.id,
      articleTitle: article.title,
      articleContent: draft.content,
      charLimit: config.xCharLimit,
      recentFeedbackWindow: config.recentFeedbackWindow,
      recentPostsForVarietyWindow: config.recentPostsForVarietyWindow,
      trendWordsLimit: config.trendWordsLimit,
    });

  const runSelfCheckFor = (hook: string, payoff: string) =>
    selfCheckUrlThreadPost(config.claudeModel, {
      hook,
      payoff,
      articleTitle: article.title,
      articleContent: draft.content,
      articleUrl,
      charLimit: config.xCharLimit,
      passThreshold: config.selfCheckPassThreshold,
    });

  const buildReplyText = (payoff: string): string => `${payoff}\n\n${articleUrl}`;

  let generated = await generate();
  let selfCheck = await runSelfCheckFor(generated.hook, generated.payoff);
  let finalHook = selfCheck.data.final_hook;
  let finalPayoff = selfCheck.data.final_payoff;
  let replyText = buildReplyText(finalPayoff);
  let hookLength = getWeightedLength(finalHook);
  let replyLength = getWeightedLength(replyText);

  for (
    let attempt = 1;
    (hookLength > config.xCharLimit || replyLength > config.xCharLimit) && attempt <= config.maxGenerateRetries;
    attempt++
  ) {
    generated = await generate();
    selfCheck = await runSelfCheckFor(generated.hook, generated.payoff);
    finalHook = selfCheck.data.final_hook;
    finalPayoff = selfCheck.data.final_payoff;
    replyText = buildReplyText(finalPayoff);
    hookLength = getWeightedLength(finalHook);
    replyLength = getWeightedLength(replyText);
  }

  // hookとreply(核心+記事URL)は別ツイートなので、文字数超過の短縮もそれぞれ独立に行う。
  for (let attempt = 1; hookLength > config.xCharLimit && attempt <= MAX_SHORTEN_ATTEMPTS; attempt++) {
    finalHook = await shortenPost(config.claudeModel, finalHook, config.xCharLimit, attempt);
    hookLength = getWeightedLength(finalHook);
  }

  for (let attempt = 1; replyLength > config.xCharLimit && attempt <= MAX_SHORTEN_ATTEMPTS; attempt++) {
    // 記事URL自体は縮められないため、URL分の文字数を差し引いた上限で核心部分だけを縮める。
    const urlOverheadLength = getWeightedLength(`\n\n${articleUrl}`);
    const payoffCharLimit = Math.max(1, config.xCharLimit - urlOverheadLength);
    finalPayoff = await shortenPost(config.claudeModel, finalPayoff, payoffCharLimit, attempt);
    replyText = buildReplyText(finalPayoff);
    replyLength = getWeightedLength(replyText);
  }

  if (hookLength > config.xCharLimit || replyLength > config.xCharLimit) {
    throw new Error(
      `記事URL付き投稿が文字数上限を超過したままです(規定回数のやり直し・短縮後も解消せず): hook=${hookLength}, reply=${replyLength} > ${config.xCharLimit}`
    );
  }

  const originSession = await findOriginSession(article.id);

  return persistAndDispatch({
    articleId: article.id,
    articleTitle: article.title,
    draftId: draft.id,
    articleUrl,
    generatedText: `${generated.hook}\n---\n${generated.payoff}`,
    finalText: finalHook,
    replyText,
    selfCheckJson: JSON.stringify(selfCheck.data),
    selfCheckData: selfCheck.data,
    repo,
    sourceIssueNumber: originSession?.issueNumber ?? null,
    approvalMode: config.approvalMode,
  });
}

// XPostのDB作成 → (GITHUB_TOKENがあれば)承認issue作成 → autoモードかつ合格ならその場で
// 投稿、までをまとめる共通処理。通常投稿・記事URL付きスレッド投稿のどちらの経路からも使う。
async function persistAndDispatch(input: PersistAndDispatchInput): Promise<GenerateXPostResult> {
  const xPost = await prisma.xPost.create({
    data: {
      articleId: input.articleId,
      draftId: input.draftId,
      articleUrl: input.articleUrl,
      generatedText: input.generatedText,
      finalText: input.finalText,
      replyText: input.replyText,
      selfCheckJson: input.selfCheckJson,
      status: "pending_approval",
      githubIssueOwner: input.repo.owner,
      githubIssueRepo: input.repo.repo,
    },
  });

  if (!process.env.GITHUB_TOKEN) {
    return {
      xPostId: xPost.id,
      articleId: input.articleId,
      articleTitle: input.articleTitle,
      finalText: input.finalText,
      replyText: input.replyText,
      score: input.selfCheckData.score,
      pass: input.selfCheckData.pass,
      status: xPost.status,
      githubIssueUrl: null,
    };
  }

  const issue = await createXPostApprovalIssue({
    articleTitle: input.articleTitle,
    finalText: input.finalText,
    replyText: input.replyText,
    replyIncludesUrl: input.replyText != null && input.articleUrl != null,
    score: input.selfCheckData.score,
    pass: input.selfCheckData.pass,
    problems: input.selfCheckData.problems,
    improvements: input.selfCheckData.improvements,
    repoOwner: input.repo.owner,
    repoName: input.repo.repo,
    sourceIssueNumber: input.sourceIssueNumber,
  });

  const updated = await prisma.xPost.update({
    where: { id: xPost.id },
    data: { githubIssueNumber: issue.number, githubIssueUrl: issue.url },
  });

  // autoモードでも、セルフチェック不合格(pass=false)の場合は必ず人の承認待ちに倒す
  // (自動投稿がセルフチェックをバイパスすることは無いようにする安全策)。
  if (input.approvalMode === "auto" && input.selfCheckData.pass) {
    await finalizeXPost(updated);
    const posted = await prisma.xPost.findUniqueOrThrow({ where: { id: xPost.id } });
    return {
      xPostId: posted.id,
      articleId: input.articleId,
      articleTitle: input.articleTitle,
      finalText: input.finalText,
      replyText: input.replyText,
      score: input.selfCheckData.score,
      pass: input.selfCheckData.pass,
      status: posted.status,
      githubIssueUrl: posted.githubIssueUrl,
    };
  }

  return {
    xPostId: updated.id,
    articleId: input.articleId,
    articleTitle: input.articleTitle,
    finalText: input.finalText,
    replyText: input.replyText,
    score: input.selfCheckData.score,
    pass: input.selfCheckData.pass,
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
