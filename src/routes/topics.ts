import { Router } from "express";
import { prisma } from "../db/client";
import { createTopicSchema, updateTopicSchema } from "../schemas/topic";

export const topicsRouter = Router();

// 編集者の企画に対応する調査テーマを作成する
topicsRouter.post("/", async (req, res) => {
  const parsed = createTopicSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const topic = await prisma.topic.create({ data: parsed.data });
  res.status(201).json(topic);
});

topicsRouter.get("/", async (_req, res) => {
  const topics = await prisma.topic.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { items: true } } },
  });
  res.json(
    topics.map((t) => ({
      id: t.id,
      title: t.title,
      theme: t.theme,
      brief: t.brief,
      status: t.status,
      itemCount: t._count.items,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }))
  );
});

topicsRouter.get("/:id", async (req, res) => {
  const topic = await prisma.topic.findUnique({ where: { id: req.params.id } });
  if (!topic) return res.status(404).json({ error: "topic not found" });
  res.json(topic);
});

topicsRouter.patch("/:id", async (req, res) => {
  const parsed = updateTopicSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const exists = await prisma.topic.findUnique({ where: { id: req.params.id } });
  if (!exists) return res.status(404).json({ error: "topic not found" });

  const topic = await prisma.topic.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  res.json(topic);
});
