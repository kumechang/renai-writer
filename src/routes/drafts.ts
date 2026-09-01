import { Router, type Request, type Response } from "express";
import type { Draft, Review } from "@prisma/client";
import { prisma } from "../db/client";
import { createDraftSchema } from "../schemas/draft";

type PlanParams = { planId: string };
type DraftParams = { planId: string; draftId: string };

const draftInclude = { review: true } as const;
type DraftWithReview = Draft & { review: Review | null };

function toDraftDTO(draft: DraftWithReview) {
  return {
    id: draft.id,
    planId: draft.planId,
    revisionNumber: draft.revisionNumber,
    title: draft.title,
    content: draft.content,
    wordCount: draft.wordCount,
    createdAt: draft.createdAt.toISOString(),
    review: draft.review
      ? {
          score: draft.review.score,
          passed: draft.review.passed,
          isFinalAttempt: draft.review.isFinalAttempt,
          feedback: draft.review.feedback,
          createdAt: draft.review.createdAt.toISOString(),
        }
      : null,
  };
}

// プランに紐づく原稿(各版)の操作。プランルーターにネストしてマウントする。
export const draftsRouter = Router({ mergeParams: true });

// ライターが執筆(または修正)した原稿を1件登録する。revisionNumberは既存件数から自動採番。
draftsRouter.post("/", async (req: Request<PlanParams>, res: Response) => {
  const planId = req.params.planId;
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) return res.status(404).json({ error: "plan not found" });

  const parsed = createDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const input = parsed.data;

  const revisionNumber = await prisma.draft.count({ where: { planId } });

  const draft = await prisma.draft.create({
    data: {
      planId,
      revisionNumber,
      title: input.title,
      content: input.content,
      wordCount: input.wordCount ?? input.content.length,
    },
    include: draftInclude,
  });

  res.status(201).json(toDraftDTO(draft));
});

draftsRouter.get("/", async (req: Request<PlanParams>, res: Response) => {
  const drafts = await prisma.draft.findMany({
    where: { planId: req.params.planId },
    include: draftInclude,
    orderBy: { revisionNumber: "asc" },
  });
  res.json(drafts.map(toDraftDTO));
});

draftsRouter.get("/:draftId", async (req: Request<DraftParams>, res: Response) => {
  const draft = await prisma.draft.findFirst({
    where: { id: req.params.draftId, planId: req.params.planId },
    include: draftInclude,
  });
  if (!draft) return res.status(404).json({ error: "draft not found" });
  res.json(toDraftDTO(draft));
});
