import { z } from "zod";

const quoteSchema = z.object({
  text: z.string().min(1),
  context: z.string().optional(),
});

// 調査員がWebから収集したデータを投入する際の入力形式。
// URL単位の出典情報(source*)と、要約・引用などの調査員による付加価値情報を分離している。
export const createResearchItemSchema = z.object({
  url: z.string().url("url は有効なURLである必要があります"),
  sourceTitle: z.string().min(1).optional(),
  author: z.string().min(1).optional(),
  siteName: z.string().min(1).optional(),
  publishedAt: z.string().datetime().optional(),

  summary: z.string().min(1, "summary は必須です"),
  keyPoints: z.array(z.string().min(1)).default([]),
  quotes: z.array(quoteSchema).default([]),

  reliability: z.number().int().min(1).max(5).default(3),
  relevance: z.number().int().min(1).max(5).default(3),

  tags: z.array(z.string().min(1)).default([]),
  collectedBy: z.string().min(1).optional(),
  notes: z.string().min(1).optional(),
});
export type CreateResearchItemInput = z.infer<typeof createResearchItemSchema>;

export const updateResearchItemSchema = z.object({
  summary: z.string().min(1).optional(),
  keyPoints: z.array(z.string().min(1)).optional(),
  quotes: z.array(quoteSchema).optional(),
  reliability: z.number().int().min(1).max(5).optional(),
  relevance: z.number().int().min(1).max(5).optional(),
  tags: z.array(z.string().min(1)).optional(),
  status: z.enum(["new", "reviewed", "used", "rejected"]).optional(),
  notes: z.string().min(1).nullable().optional(),
});
export type UpdateResearchItemInput = z.infer<typeof updateResearchItemSchema>;

export const listResearchItemsQuerySchema = z.object({
  tag: z.string().min(1).optional(),
  status: z.enum(["new", "reviewed", "used", "rejected"]).optional(),
  minRelevance: z.coerce.number().int().min(1).max(5).optional(),
});
export type ListResearchItemsQuery = z.infer<typeof listResearchItemsQuerySchema>;
