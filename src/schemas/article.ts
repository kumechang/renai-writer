import { z } from "zod";

// Article作成時の入力検証。titleがPlan.titleCandidatesに含まれるかは
// DBを見る必要があるため、ルートハンドラ側でチェックする。
export const createArticleSchema = z.object({
  title: z.string().min(1, "title は必須です"),
});
export type CreateArticleInput = z.infer<typeof createArticleSchema>;

export const articleStatusValues = [
  "drafting",
  "in_review",
  "needs_revision",
  "accepted",
  "accepted_with_reservation",
  "needs_human_review",
] as const;

export const updateArticleSchema = z.object({
  status: z.enum(articleStatusValues).optional(),
});
export type UpdateArticleInput = z.infer<typeof updateArticleSchema>;
