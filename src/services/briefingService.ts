import type { Topic } from "@prisma/client";
import { prisma } from "../db/client";
import { toResearchItemDTO, type ResearchItemDTO } from "./researchItemMapper";

export interface Briefing {
  topic: Pick<Topic, "id" | "title" | "theme" | "brief" | "status">;
  itemCount: number;
  items: ResearchItemDTO[];
  generatedAt: string;
}

// ライターが記事執筆にそのまま使えるよう、関連度・信頼度の高い順に
// トピック配下の調査データを集約する。
export async function buildBriefing(topicId: string): Promise<Briefing | null> {
  const topic = await prisma.topic.findUnique({ where: { id: topicId } });
  if (!topic) return null;

  const items = await prisma.researchItem.findMany({
    where: { topicId, status: { not: "rejected" } },
    include: { source: true, tags: true },
    orderBy: [{ relevance: "desc" }, { reliability: "desc" }, { createdAt: "asc" }],
  });

  return {
    topic: {
      id: topic.id,
      title: topic.title,
      theme: topic.theme,
      brief: topic.brief,
      status: topic.status,
    },
    itemCount: items.length,
    items: items.map(toResearchItemDTO),
    generatedAt: new Date().toISOString(),
  };
}

function stars(score: number): string {
  const filled = Math.max(0, Math.min(5, score));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

// ライターがそのまま読める調査資料としてMarkdownに整形する。
export function renderBriefingMarkdown(briefing: Briefing): string {
  const { topic, items } = briefing;
  const lines: string[] = [];

  lines.push(`# ${topic.title} — 調査資料`);
  if (topic.theme) lines.push(`\n**記事の切り口:** ${topic.theme}`);
  if (topic.brief) lines.push(`\n**編集者からの依頼:** ${topic.brief}`);
  lines.push(`\n収集件数: ${items.length}件\n`);

  items.forEach((item, index) => {
    const sourceTitle = item.source.title ?? item.source.url;
    lines.push(`## ${index + 1}. [${sourceTitle}](${item.source.url})`);
    lines.push(
      `- 出典: ${item.source.siteName ?? item.source.domain}${
        item.source.author ? ` / ${item.source.author}` : ""
      }`
    );
    lines.push(`- 信頼度: ${stars(item.reliability)} / 関連度: ${stars(item.relevance)}`);
    if (item.tags.length) lines.push(`- タグ: ${item.tags.map((t) => `#${t}`).join(" ")}`);
    lines.push(`\n${item.summary}\n`);

    if (item.keyPoints.length) {
      lines.push("**重要ポイント:**");
      item.keyPoints.forEach((p) => lines.push(`- ${p}`));
      lines.push("");
    }

    if (item.quotes.length) {
      lines.push("**引用:**");
      item.quotes.forEach((q) => {
        lines.push(`> ${q.text}`);
        if (q.context) lines.push(`> —— ${q.context}`);
      });
      lines.push("");
    }

    lines.push("---\n");
  });

  return lines.join("\n");
}
