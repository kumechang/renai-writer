import { z } from "zod";

const RECOMMENDED_TITLE_COUNT = 10;

// 編集者(Claude)が submit_plan ツールで送ってくる企画データの検証。
export const createPlanSchema = z
  .object({
    theme: z.string().min(1, "theme は必須です"),
    targetReader: z.string().min(1, "targetReader は必須です"),
    structure: z.string().min(1, "structure は必須です"),
    volume: z.string().min(1, "volume は必須です"),
    paidSection: z.string().min(1, "paidSection は必須です"),
    titleCandidates: z
      .array(z.string().min(1))
      .length(50, "titleCandidates はちょうど50件である必要があります"),
    recommendedTitles: z
      .array(z.string().min(1))
      .length(
        RECOMMENDED_TITLE_COUNT,
        `recommendedTitles はちょうど${RECOMMENDED_TITLE_COUNT}件である必要があります`
      ),
  })
  .refine(
    (data) => data.recommendedTitles.every((title) => data.titleCandidates.includes(title)),
    {
      message: "recommendedTitles はすべて titleCandidates に含まれている必要があります",
      path: ["recommendedTitles"],
    }
  )
  .refine((data) => new Set(data.recommendedTitles).size === data.recommendedTitles.length, {
    message: "recommendedTitles に重複があります",
    path: ["recommendedTitles"],
  });
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

export const planStatusValues = ["planning", "ready", "archived"] as const;

export const updatePlanSchema = z.object({
  status: z.enum(planStatusValues).optional(),
});
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
