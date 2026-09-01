import { Router, type Request, type Response } from "express";
import { buildBriefing, renderBriefingMarkdown } from "../services/briefingService";

export const briefingRouter = Router({ mergeParams: true });

type TopicParams = { topicId: string };

// ライターが記事を書く際に参照する集約ビュー。?format=markdown で読み物として取得できる。
briefingRouter.get("/", async (req: Request<TopicParams>, res: Response) => {
  const briefing = await buildBriefing(req.params.topicId);
  if (!briefing) return res.status(404).json({ error: "topic not found" });

  if (req.query.format === "markdown") {
    res.type("text/markdown").send(renderBriefingMarkdown(briefing));
    return;
  }

  res.json(briefing);
});
