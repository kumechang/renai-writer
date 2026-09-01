import { z } from "zod";

export const createTopicSchema = z.object({
  title: z.string().min(1, "title は必須です"),
  theme: z.string().min(1).optional(),
  brief: z.string().min(1).optional(),
});
export type CreateTopicInput = z.infer<typeof createTopicSchema>;

export const updateTopicSchema = z.object({
  title: z.string().min(1).optional(),
  theme: z.string().min(1).nullable().optional(),
  brief: z.string().min(1).nullable().optional(),
  status: z.enum(["collecting", "ready", "archived"]).optional(),
});
export type UpdateTopicInput = z.infer<typeof updateTopicSchema>;
