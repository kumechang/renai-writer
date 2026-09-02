import Anthropic from "@anthropic-ai/sdk";
import { fetchJson } from "../shared/http";
import { extractText } from "../shared/anthropic";
import { createRequestResearchTool } from "../shared/requestResearchTool";
import type { AgentRunConfig, DraftResponse, PlanResponse } from "../shared/types";
import { buildEditorPlanningSystemPrompt, buildEditorReviewSystemPrompt } from "./systemPrompt";
import { createReviewDraftTool, createSubmitPlanTool } from "./tools";

const MODEL = "claude-sonnet-5";

export interface PlanResult {
  planId: string;
  summary: string;
}

// 編集者による企画立案。テーマから想定読者・構成・ボリューム・有料部分・
// タイトル案50個を作らせ、submit_plan で登録させる。
export async function runEditorPlanning(
  theme: string,
  config: AgentRunConfig
): Promise<PlanResult> {
  const client = new Anthropic();
  let planId: string | undefined;

  const submitPlanTool = createSubmitPlanTool({
    apiBaseUrl: config.apiBaseUrl,
    theme,
    onCreated: (id) => {
      planId = id;
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

  if (!planId) {
    throw new Error("編集者が企画(submit_plan)を登録しませんでした");
  }

  return { planId, summary };
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
  draftId: string,
  isFinalAttempt: boolean,
  config: AgentRunConfig
): Promise<ReviewResult> {
  const plan = await fetchJson<PlanResponse>(`${config.apiBaseUrl}/api/plans/${planId}`);
  const draft = await fetchJson<DraftResponse>(
    `${config.apiBaseUrl}/api/plans/${planId}/drafts/${draftId}`
  );

  const client = new Anthropic();
  let result: { score: number; passed: boolean; feedback: string } | undefined;

  const reviewDraftTool = createReviewDraftTool({
    apiBaseUrl: config.apiBaseUrl,
    planId,
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
    system: buildEditorReviewSystemPrompt(plan, draft, isFinalAttempt),
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
