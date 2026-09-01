import { Router } from "express";
import { prisma } from "../db/client";
import { createPlanSchema, updatePlanSchema } from "../schemas/plan";
import { toPlanDTO } from "../services/planMapper";

export const plansRouter = Router();

// 編集者が立てた記事企画(想定読者・構成・ボリューム・有料部分・タイトル案50個)を登録する
plansRouter.post("/", async (req, res) => {
  const parsed = createPlanSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { titleCandidates, ...rest } = parsed.data;

  const plan = await prisma.plan.create({
    data: { ...rest, titleCandidates: JSON.stringify(titleCandidates) },
  });
  res.status(201).json(toPlanDTO(plan));
});

plansRouter.get("/", async (_req, res) => {
  const plans = await prisma.plan.findMany({ orderBy: { createdAt: "desc" } });
  res.json(plans.map(toPlanDTO));
});

plansRouter.get("/:id", async (req, res) => {
  const plan = await prisma.plan.findUnique({ where: { id: req.params.id } });
  if (!plan) return res.status(404).json({ error: "plan not found" });
  res.json(toPlanDTO(plan));
});

// selectedTitle の確定(人間またはワークフローによる上書き)やstatus遷移を行う
plansRouter.patch("/:id", async (req, res) => {
  const parsed = updatePlanSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const existing = await prisma.plan.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "plan not found" });

  if (parsed.data.selectedTitle) {
    const candidates: string[] = JSON.parse(existing.titleCandidates);
    if (!candidates.includes(parsed.data.selectedTitle)) {
      return res.status(400).json({
        error: "selectedTitle は titleCandidates に含まれている必要があります",
      });
    }
  }

  const plan = await prisma.plan.update({
    where: { id: req.params.id },
    data: parsed.data,
  });
  res.json(toPlanDTO(plan));
});
