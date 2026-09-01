import express from "express";
import { topicsRouter } from "./routes/topics";
import { itemsRouter } from "./routes/items";
import { briefingRouter } from "./routes/briefing";
import { tagsRouter } from "./routes/tags";
import { plansRouter } from "./routes/plans";
import { draftsRouter } from "./routes/drafts";
import { reviewsRouter } from "./routes/reviews";

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/topics", topicsRouter);
  app.use("/api/topics/:topicId/items", itemsRouter);
  app.use("/api/topics/:topicId/briefing", briefingRouter);
  app.use("/api/tags", tagsRouter);

  app.use("/api/plans", plansRouter);
  app.use("/api/plans/:planId/drafts", draftsRouter);
  app.use("/api/plans/:planId/drafts/:draftId/review", reviewsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  return app;
}
