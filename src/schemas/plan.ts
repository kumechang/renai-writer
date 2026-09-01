import { z } from "zod";

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
    recommendedTitle: z.string().min(1, "recommendedTitle は必須です"),
  })
  .refine((data) => data.titleCandidates.includes(data.recommendedTitle), {
    message: "recommendedTitle は titleCandidates に含まれている必要があります",
    path: ["recommendedTitle"],
  });
export type CreatePlanInput = z.infer<typeof createPlanSchema>;

export const planStatusValues = [
  "planning",
  "drafting",
  "in_review",
  "needs_revision",
  "accepted",
  "accepted_with_reservation",
  "needs_human_review",
  "archived",
] as const;

export const updatePlanSchema = z.object({
  selectedTitle: z.string().min(1).nullable().optional(),
  status: z.enum(planStatusValues).optional(),
});
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
