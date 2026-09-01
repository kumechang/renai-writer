import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";

// betaZodTool は zod/v4 の ZodType を要求するため、REST API側(src/schemas)が使う
// classic zod(v3 API)とは別に、ツール入力用のスキーマをここで定義する。
// フィールドの意味・制約は src/schemas/plan.ts の createPlanSchema と揃えている。
const submitPlanInputSchema = z
  .object({
    targetReader: z.string().min(1).describe("想定読者"),
    structure: z.string().min(1).describe("Markdown形式の記事構成案"),
    volume: z.string().min(1).describe("全体および無料/有料部分の目安文字数"),
    paidSection: z.string().min(1).describe("有料部分の区切り位置とその狙い"),
    titleCandidates: z.array(z.string().min(1)).length(50).describe("タイトル案(ちょうど50個)"),
    recommendedTitle: z.string().min(1).describe("titleCandidatesの中から推奨する1つ"),
  })
  .refine((data) => data.titleCandidates.includes(data.recommendedTitle), {
    message: "recommendedTitle は titleCandidates に含まれている必要があります",
    path: ["recommendedTitle"],
  });

export interface SubmitPlanToolConfig {
  apiBaseUrl: string;
  theme: string;
  onCreated: (planId: string) => void;
}

export function createSubmitPlanTool(config: SubmitPlanToolConfig) {
  return betaZodTool({
    name: "submit_plan",
    description:
      "検討した記事企画(想定読者・構成・ボリューム・有料部分の設計・タイトル案50個)を登録する。",
    inputSchema: submitPlanInputSchema,
    run: async (input) => {
      const res = await fetch(`${config.apiBaseUrl}/api/plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: config.theme, ...input }),
      });
      if (!res.ok) {
        return `企画の登録に失敗しました (HTTP ${res.status}): ${await res.text()}`;
      }
      const created = (await res.json()) as { id: string };
      config.onCreated(created.id);
      return `企画を登録しました: id=${created.id}`;
    },
  });
}

const reviewDraftInputSchema = z.object({
  score: z.number().int().min(0).max(100).describe("0〜100点の整数評価"),
  feedback: z.string().min(1).describe("具体的な指摘・判断理由"),
});

export interface ReviewDraftToolConfig {
  apiBaseUrl: string;
  planId: string;
  draftId: string;
  isFinalAttempt: boolean;
  onReviewed: (result: { score: number; passed: boolean; feedback: string }) => void;
}

export function createReviewDraftTool(config: ReviewDraftToolConfig) {
  return betaZodTool({
    name: "review_draft",
    description: "ライターが提出した原稿を0〜100点で採点し、フィードバックとともに登録する。",
    inputSchema: reviewDraftInputSchema,
    run: async (input) => {
      const res = await fetch(
        `${config.apiBaseUrl}/api/plans/${config.planId}/drafts/${config.draftId}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...input, isFinalAttempt: config.isFinalAttempt }),
        }
      );
      if (!res.ok) {
        return `レビューの登録に失敗しました (HTTP ${res.status}): ${await res.text()}`;
      }
      const created = (await res.json()) as { passed: boolean };
      config.onReviewed({ score: input.score, passed: created.passed, feedback: input.feedback });
      return `レビューを登録しました: score=${input.score} passed=${created.passed}`;
    },
  });
}
