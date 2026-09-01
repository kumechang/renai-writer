import { Router, type Request, type Response } from "express";
import { prisma } from "../db/client";
import {
  createResearchItemSchema,
  listResearchItemsQuerySchema,
  updateResearchItemSchema,
} from "../schemas/researchItem";
import { toResearchItemDTO } from "../services/researchItemMapper";
import { extractDomain } from "../services/url";

const itemInclude = { source: true, tags: true } as const;

// トピック配下の調査データ操作。ネストしたルーターとしてトピックルーターにマウントする。
export const itemsRouter = Router({ mergeParams: true });

type TopicParams = { topicId: string };
type ItemParams = { topicId: string; itemId: string };

// 調査員がWebから集めたデータを1件登録する
itemsRouter.post("/", async (req: Request<TopicParams>, res: Response) => {
  const topicId = req.params.topicId;
  const topic = await prisma.topic.findUnique({ where: { id: topicId } });
  if (!topic) return res.status(404).json({ error: "topic not found" });

  const parsed = createResearchItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const input = parsed.data;

  const source = await prisma.source.upsert({
    where: { url: input.url },
    update: {
      title: input.sourceTitle,
      author: input.author,
      siteName: input.siteName,
      publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
    },
    create: {
      url: input.url,
      domain: extractDomain(input.url),
      title: input.sourceTitle,
      author: input.author,
      siteName: input.siteName,
      publishedAt: input.publishedAt ? new Date(input.publishedAt) : undefined,
    },
  });

  const item = await prisma.researchItem.create({
    data: {
      topicId,
      sourceId: source.id,
      summary: input.summary,
      keyPoints: JSON.stringify(input.keyPoints),
      quotes: JSON.stringify(input.quotes),
      reliability: input.reliability,
      relevance: input.relevance,
      collectedBy: input.collectedBy,
      notes: input.notes,
      tags: {
        connectOrCreate: input.tags.map((name) => ({
          where: { name },
          create: { name },
        })),
      },
    },
    include: itemInclude,
  });

  res.status(201).json(toResearchItemDTO(item));
});

// トピックに紐づく調査データ一覧を取得する（tag/status/relevanceで絞り込み可）
itemsRouter.get("/", async (req: Request<TopicParams>, res: Response) => {
  const topicId = req.params.topicId;
  const parsedQuery = listResearchItemsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    return res.status(400).json({ error: parsedQuery.error.flatten() });
  }
  const { tag, status, minRelevance } = parsedQuery.data;

  const items = await prisma.researchItem.findMany({
    where: {
      topicId,
      status,
      relevance: minRelevance ? { gte: minRelevance } : undefined,
      tags: tag ? { some: { name: tag } } : undefined,
    },
    include: itemInclude,
    orderBy: [{ relevance: "desc" }, { reliability: "desc" }, { createdAt: "desc" }],
  });

  res.json(items.map(toResearchItemDTO));
});

// 個別の調査データを更新する（ライター/編集者によるステータス変更・修正を想定）
itemsRouter.patch("/:itemId", async (req: Request<ItemParams>, res: Response) => {
  const parsed = updateResearchItemSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const existing = await prisma.researchItem.findFirst({
    where: { id: req.params.itemId, topicId: req.params.topicId },
  });
  if (!existing) return res.status(404).json({ error: "research item not found" });

  const { keyPoints, quotes, tags, ...rest } = parsed.data;

  const item = await prisma.researchItem.update({
    where: { id: req.params.itemId },
    data: {
      ...rest,
      keyPoints: keyPoints ? JSON.stringify(keyPoints) : undefined,
      quotes: quotes ? JSON.stringify(quotes) : undefined,
      tags: tags
        ? {
            set: [],
            connectOrCreate: tags.map((name) => ({
              where: { name },
              create: { name },
            })),
          }
        : undefined,
    },
    include: itemInclude,
  });

  res.json(toResearchItemDTO(item));
});

itemsRouter.delete("/:itemId", async (req: Request<ItemParams>, res: Response) => {
  const existing = await prisma.researchItem.findFirst({
    where: { id: req.params.itemId, topicId: req.params.topicId },
  });
  if (!existing) return res.status(404).json({ error: "research item not found" });

  await prisma.researchItem.delete({ where: { id: req.params.itemId } });
  res.status(204).send();
});
