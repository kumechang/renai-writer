import { z } from "zod";

// 編集者(Claude)が review_draft ツールで送ってくる採点データの検証。
export const createReviewSchema = z.object({
  score: z.number().int().min(0).max(100, "score は0〜100の整数である必要があります"),
  feedback: z.string().min(1, "feedback は必須です"),
  isFinalAttempt: z.boolean().default(false),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;
