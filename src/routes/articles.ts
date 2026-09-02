import { Router, type Request, type Response } from "express";
import { prisma } from "../db/client";
import { createArticleSchema, updateArticleSchema } from "../schemas/article";

type PlanParams = { planId: string };
type ArticleParams = { planId: string; articleId: string };

function toArticleDTO(article: {
  id: string;
  planId: string;
  title: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: article.id,
    planId: article.planId,
    title: article.title,
    status: article.status,
    createdAt: article.createdAt.toISOString(),
    updatedAt: article.updatedAt.toISOString(),
  };
}

// 企画配下の記事(タイトルごとに独立して執筆・レビューが進む単位)の操作。
// プランルーターにネストしてマウントする。
export const articlesRouter = Router({ mergeParams: true });

// 企画のタイトル候補から1つを選んで記事を作成する
articlesRouter.post("/", async (req: Request<PlanParams>, res: Response) => {
  const plan = await prisma.plan.findUnique({ where: { id: req.params.planId } });
  if (!plan) return res.status(404).json({ error: "plan not found" });

  const parsed = createArticleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const candidates: string[] = JSON.parse(plan.titleCandidates);
  if (!candidates.includes(parsed.data.title)) {
    return res.status(400).json({
      error: "title は Plan.titleCandidates に含まれている必要があります",
    });
  }

  const article = await prisma.article.create({
    data: { planId: plan.id, title: parsed.data.title },
  });
  res.status(201).json(toArticleDTO(article));
});

articlesRouter.get("/", async (req: Request<PlanParams>, res: Response) => {
  const articles = await prisma.article.findMany({
    where: { planId: req.params.planId },
    orderBy: { createdAt: "asc" },
  });
  res.json(articles.map(toArticleDTO));
});

articlesRouter.get("/:articleId", async (req: Request<ArticleParams>, res: Response) => {
  const article = await prisma.article.findFirst({
    where: { id: req.params.articleId, planId: req.params.planId },
  });
  if (!article) return res.status(404).json({ error: "article not found" });
  res.json(toArticleDTO(article));
});

// status遷移(drafting -> in_review -> needs_revision -> accepted / ...)を行う
articlesRouter.patch("/:articleId", async (req: Request<ArticleParams>, res: Response) => {
  const parsed = updateArticleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const existing = await prisma.article.findFirst({
    where: { id: req.params.articleId, planId: req.params.planId },
  });
  if (!existing) return res.status(404).json({ error: "article not found" });

  const article = await prisma.article.update({
    where: { id: req.params.articleId },
    data: parsed.data,
  });
  res.json(toArticleDTO(article));
});
