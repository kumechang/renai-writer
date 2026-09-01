import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";

const submitDraftInputSchema = z.object({
  title: z.string().min(1).describe("記事タイトル(企画のタイトルと同じ)"),
  content: z.string().min(1).describe("記事本文の全文(Markdown、差分ではなく全体)"),
});

export interface SubmitDraftToolConfig {
  apiBaseUrl: string;
  planId: string;
  onCreated: (draft: { id: string; revisionNumber: number }) => void;
}

// 執筆(または修正)した記事の全文を登録するツール。
export function createSubmitDraftTool(config: SubmitDraftToolConfig) {
  return betaZodTool({
    name: "submit_draft",
    description: "執筆(または修正)した記事の本文全文を登録する。差分ではなく必ず全文を渡すこと。",
    inputSchema: submitDraftInputSchema,
    run: async (input) => {
      const res = await fetch(`${config.apiBaseUrl}/api/plans/${config.planId}/drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        return `原稿の登録に失敗しました (HTTP ${res.status}): ${await res.text()}`;
      }
      const created = (await res.json()) as { id: string; revisionNumber: number };
      config.onCreated(created);
      return `原稿を登録しました: id=${created.id} revision=${created.revisionNumber}`;
    },
  });
}
