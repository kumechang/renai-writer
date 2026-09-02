import { Router, type Request, type Response } from "express";
import type { Draft, Review } from "@prisma/client";
import { prisma } from "../db/client";
import { createDraftSchema } from "../schemas/draft";

type ArticleParams = { planId: string; articleId: string };
type DraftParams = { planId: string; articleId: string; draftId: string };

const draftInclude = { review: true } as const;
type DraftWithReview = Draft & { review: Review | null };

function toDraftDTO(draft: DraftWithReview) {
  return {
    id: draft.id,
    articleId: draft.articleId,
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

// 記事(Article)に紐づく原稿(各版)の操作。記事ルーターにネストしてマウントする。
export const draftsRouter = Router({ mergeParams: true });

// ライターが執筆(または修正)した原稿を1件登録する。revisionNumberは既存件数から自動採番。
draftsRouter.post("/", async (req: Request<ArticleParams>, res: Response) => {
  const { planId, articleId } = req.params;
  const article = await prisma.article.findFirst({ where: { id: articleId, planId } });
  if (!article) return res.status(404).json({ error: "article not found" });

  const parsed = createDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const input = parsed.data;

  const revisionNumber = await prisma.draft.count({ where: { articleId } });

  const draft = await prisma.draft.create({
    data: {
      articleId,
      revisionNumber,
      title: input.title,
      content: input.content,
      wordCount: input.wordCount ?? input.content.length,
    },
    include: draftInclude,
  });

  res.status(201).json(toDraftDTO(draft));
});

draftsRouter.get("/", async (req: Request<ArticleParams>, res: Response) => {
  const drafts = await prisma.draft.findMany({
    where: { articleId: req.params.articleId },
    include: draftInclude,
    orderBy: { revisionNumber: "asc" },
  });
  res.json(drafts.map(toDraftDTO));
});

draftsRouter.get("/:draftId", async (req: Request<DraftParams>, res: Response) => {
  const draft = await prisma.draft.findFirst({
    where: { id: req.params.draftId, articleId: req.params.articleId },
    include: draftInclude,
  });
  if (!draft) return res.status(404).json({ error: "draft not found" });
  res.json(toDraftDTO(draft));
});
