import Anthropic from "@anthropic-ai/sdk";
import { fetchJson } from "../shared/http";
import { extractText } from "../shared/anthropic";
import { createRequestResearchTool } from "../shared/requestResearchTool";
import type { AgentRunConfig, ArticleResponse, DraftResponse, PlanResponse } from "../shared/types";
import { buildEditorPlanningSystemPrompt, buildEditorReviewSystemPrompt } from "./systemPrompt";
import { createReviewDraftTool, createSubmitPlanTool } from "./tools";

const MODEL = "claude-sonnet-5";

export interface PlanResult {
  planId: string;
  articleId: string;
  title: string;
  summary: string;
}

// 編集者による企画立案。テーマから想定読者・構成・ボリューム・有料部分・
// タイトル案50個(うち推奨10個)を作らせ、submit_plan で登録させる。
// 自動実行パイプラインは1記事のみを書くため、推奨タイトルの1つ目でArticleも作成する。
export async function runEditorPlanning(
  theme: string,
  config: AgentRunConfig
): Promise<PlanResult> {
  const client = new Anthropic();
  let created: { planId: string; articleId: string; title: string } | undefined;

  const submitPlanTool = createSubmitPlanTool({
    apiBaseUrl: config.apiBaseUrl,
    theme,
    onCreated: (result) => {
      created = result;
    },
  });
  const requestResearchTool = createRequestResearchTool({
    apiBaseUrl: config.apiBaseUrl,
    collectedBy: config.collectedBy,
  });

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: buildEditorPlanningSystemPrompt(theme),
    tools: [requestResearchTool, submitPlanTool],
    messages: [
      { role: "user", content: `次のテーマで記事企画を立ててください。\n\nテーマ:\n${theme}` },
    ],
    stream: true,
  });

  for await (const stream of runner) {
    const message = await stream.finalMessage();
    if (message.stop_reason === "pause_turn") {
      runner.pushMessages({ role: "assistant", content: message.content });
    }
  }

  const finalMessage = await runner.done();
  const summary = extractText(finalMessage);

  if (!created) {
    throw new Error("編集者が企画(submit_plan)を登録しませんでした");
  }

  return { ...created, summary };
}

export interface ReviewResult {
  score: number;
  passed: boolean;
  feedback: string;
  summary: string;
}

// 編集者によるレビュー。企画内容と原稿を渡して0〜100点で採点させ、
// review_draft で登録させる。
export async function runEditorReview(
  planId: string,
  articleId: string,
  draftId: string,
  isFinalAttempt: boolean,
  config: AgentRunConfig
): Promise<ReviewResult> {
  const plan = await fetchJson<PlanResponse>(`${config.apiBaseUrl}/api/plans/${planId}`);
  const article = await fetchJson<ArticleResponse>(
    `${config.apiBaseUrl}/api/plans/${planId}/articles/${articleId}`
  );
  const draft = await fetchJson<DraftResponse>(
    `${config.apiBaseUrl}/api/plans/${planId}/articles/${articleId}/drafts/${draftId}`
  );

  const client = new Anthropic();
  let result: { score: number; passed: boolean; feedback: string } | undefined;

  const reviewDraftTool = createReviewDraftTool({
    apiBaseUrl: config.apiBaseUrl,
    planId,
    articleId,
    draftId,
    isFinalAttempt,
    onReviewed: (r) => {
      result = r;
    },
  });

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: buildEditorReviewSystemPrompt(plan, article.title, draft, isFinalAttempt),
    tools: [reviewDraftTool],
    messages: [
      { role: "user", content: "この原稿をレビューし、review_draft ツールで採点してください。" },
    ],
    stream: true,
  });

  for await (const stream of runner) {
    const message = await stream.finalMessage();
    if (message.stop_reason === "pause_turn") {
      runner.pushMessages({ role: "assistant", content: message.content });
    }
  }

  const finalMessage = await runner.done();
  const summary = extractText(finalMessage);

  if (!result) {
    throw new Error("編集者がレビュー(review_draft)を登録しませんでした");
  }

  return { ...result, summary };
}
