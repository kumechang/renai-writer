import Anthropic from "@anthropic-ai/sdk";
import { fetchJson } from "../shared/http";
import { extractText } from "../shared/anthropic";
import { createRequestResearchTool } from "../shared/requestResearchTool";
import type { AgentRunConfig, DraftResponse, PlanResponse } from "../shared/types";
import { buildWriterDraftSystemPrompt, buildWriterRevisionSystemPrompt } from "./systemPrompt";
import { createSubmitDraftTool } from "./tools";

const MODEL = "claude-opus-5";

export interface DraftResult {
  draftId: string;
  revisionNumber: number;
  summary: string;
}

async function runWriterTool(
  systemPrompt: string,
  userMessage: string,
  config: AgentRunConfig,
  planId: string
): Promise<DraftResult> {
  const client = new Anthropic();
  let created: { id: string; revisionNumber: number } | undefined;

  const submitDraftTool = createSubmitDraftTool({
    apiBaseUrl: config.apiBaseUrl,
    planId,
    onCreated: (d) => {
      created = d;
    },
  });
  const requestResearchTool = createRequestResearchTool({
    apiBaseUrl: config.apiBaseUrl,
    collectedBy: config.collectedBy,
  });

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    system: systemPrompt,
    tools: [requestResearchTool, submitDraftTool],
    messages: [{ role: "user", content: userMessage }],
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
    throw new Error("ライターが原稿(submit_draft)を登録しませんでした");
  }

  return { draftId: created.id, revisionNumber: created.revisionNumber, summary };
}

// ライターによる初稿執筆。企画に沿って記事本文を書かせ、submit_draft で登録させる。
export async function runWriterDraft(
  planId: string,
  config: AgentRunConfig
): Promise<DraftResult> {
  const plan = await fetchJson<PlanResponse>(`${config.apiBaseUrl}/api/plans/${planId}`);

  return runWriterTool(
    buildWriterDraftSystemPrompt(plan),
    "企画に沿って記事本文を執筆してください。",
    config,
    planId
  );
}

// ライターによる修正。直前の原稿と編集者のレビューを渡して書き直させ、
// submit_draft で新しい版として登録させる。
export async function runWriterRevision(
  planId: string,
  previousDraftId: string,
  isFinalAttempt: boolean,
  config: AgentRunConfig
): Promise<DraftResult> {
  const plan = await fetchJson<PlanResponse>(`${config.apiBaseUrl}/api/plans/${planId}`);
  const previousDraft = await fetchJson<DraftResponse>(
    `${config.apiBaseUrl}/api/plans/${planId}/drafts/${previousDraftId}`
  );

  return runWriterTool(
    buildWriterRevisionSystemPrompt(plan, previousDraft, isFinalAttempt),
    "編集者のフィードバックを踏まえて原稿を修正してください。",
    config,
    planId
  );
}
