import { z } from "zod";

// ライター(Claude)が submit_draft ツールで送ってくる原稿データの検証。
export const createDraftSchema = z.object({
  title: z.string().min(1, "title は必須です"),
  content: z.string().min(1, "content は必須です"),
  // 省略時は content の文字数から自動計算する
  wordCount: z.number().int().positive().optional(),
});
export type CreateDraftInput = z.infer<typeof createDraftSchema>;
