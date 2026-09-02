import { Router, type Request, type Response } from "express";
import { prisma } from "../db/client";
import { createReviewSchema } from "../schemas/review";

type DraftParams = { planId: string; articleId: string; draftId: string };

function toReviewDTO(review: {
  id: string;
  draftId: string;
  score: number;
  passed: boolean;
  isFinalAttempt: boolean;
  feedback: string;
  createdAt: Date;
}) {
  return {
    id: review.id,
    draftId: review.draftId,
    score: review.score,
    passed: review.passed,
    isFinalAttempt: review.isFinalAttempt,
    feedback: review.feedback,
    createdAt: review.createdAt.toISOString(),
  };
}

// 1原稿に対する編集者のレビュー(採点)。原稿ルーターにネストしてマウントする。
export const reviewsRouter = Router({ mergeParams: true });

// 編集者が原稿を0〜100点で採点し、フィードバックとともに登録する(1原稿につき1回のみ)
reviewsRouter.post("/", async (req: Request<DraftParams>, res: Response) => {
  const draft = await prisma.draft.findFirst({
    where: { id: req.params.draftId, articleId: req.params.articleId },
  });
  if (!draft) return res.status(404).json({ error: "draft not found" });

  const existing = await prisma.review.findUnique({ where: { draftId: draft.id } });
  if (existing) {
    return res.status(409).json({ error: "この原稿は既にレビュー済みです" });
  }

  const parsed = createReviewSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const input = parsed.data;

  const review = await prisma.review.create({
    data: {
      draftId: draft.id,
      score: input.score,
      passed: input.score >= 80,
      isFinalAttempt: input.isFinalAttempt,
      feedback: input.feedback,
    },
  });

  res.status(201).json(toReviewDTO(review));
});

reviewsRouter.get("/", async (req: Request<DraftParams>, res: Response) => {
  const draft = await prisma.draft.findFirst({
    where: { id: req.params.draftId, articleId: req.params.articleId },
  });
  if (!draft) return res.status(404).json({ error: "draft not found" });

  const review = await prisma.review.findUnique({ where: { draftId: draft.id } });
  if (!review) return res.status(404).json({ error: "review not found" });

  res.json(toReviewDTO(review));
});
