import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
// betaZodTool は zod/v4 の ZodType を要求するため、REST API側(src/schemas)が使う
// classic zod(v3 API)とは別に、ツール入力用のスキーマをここで定義する。
// フィールドの意味・制約は src/schemas/researchItem.ts の createResearchItemSchema と揃えている。
import * as z from "zod/v4";

const quoteSchema = z.object({
  text: z.string().min(1),
  context: z.string().optional(),
});

// collectedBy はエージェント側で固定値を付与するため、モデルの入力には含めない
const submitInputSchema = z.object({
  url: z.string().min(1).describe("情報源の完全なURL(実際にweb_search/web_fetchで確認したもの)"),
  sourceTitle: z.string().min(1).optional().describe("情報源ページのタイトル"),
  author: z.string().min(1).optional(),
  siteName: z.string().min(1).optional(),
  publishedAt: z.string().min(1).optional().describe("ISO8601形式の公開日時(わかる場合のみ)"),

  summary: z.string().min(1).describe("元記事の丸写しではない、日本語での要約(2〜4文)"),
  keyPoints: z.array(z.string().min(1)).default([]).describe("重要ポイントの箇条書き(日本語)"),
  quotes: z.array(quoteSchema).default([]).describe("原文どおりの引用と、その文脈"),

  reliability: z.number().int().min(1).max(5).default(3).describe("信頼度(1〜5)"),
  relevance: z.number().int().min(1).max(5).default(3).describe("テーマとの関連度(1〜5)"),

  tags: z.array(z.string().min(1)).default([]).describe("日本語タグ(2〜5個)"),
  notes: z.string().min(1).optional(),
});

export interface SubmitToolConfig {
  topicId: string;
  apiBaseUrl: string;
  collectedBy: string;
}

// 調査員(Claude)が集めた1件の情報を、既存の保存API
// (POST /api/topics/:topicId/items) にそのまま登録するツール。
export function createSubmitResearchItemTool(config: SubmitToolConfig) {
  return betaZodTool({
    name: "submit_research_item",
    description:
      "調査で見つけた1件の情報源を、要約・重要ポイント・引用・信頼度/関連度スコア・タグとともに" +
      "データベースへ登録する。web_search/web_fetchで実際に内容を確認した情報のみを登録すること。" +
      "同一URLを重複登録しないこと。",
    inputSchema: submitInputSchema,
    run: async (input) => {
      const res = await fetch(`${config.apiBaseUrl}/api/topics/${config.topicId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...input, collectedBy: config.collectedBy }),
      });

      if (!res.ok) {
        const body = await res.text();
        return `登録に失敗しました (HTTP ${res.status}): ${body}`;
      }

      const created = (await res.json()) as { id: string; source: { url: string } };
      return `登録完了: id=${created.id} url=${created.source.url}`;
    },
  });
}

// Anthropic-defined server tools。実行はAnthropic側で行われる。
export const webSearchTool = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: 10,
} as const;

export const webFetchTool = {
  type: "web_fetch_20260209",
  name: "web_fetch",
  max_uses: 10,
} as const;
