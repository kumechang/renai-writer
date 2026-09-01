import type { ResearchItem, Source, Tag } from "@prisma/client";

export type ResearchItemWithRelations = ResearchItem & {
  source: Source;
  tags: Tag[];
};

export interface Quote {
  text: string;
  context?: string;
}

// ライター/フロントが扱いやすいよう、DB保存形式(JSON文字列)を配列に戻して返す。
export interface ResearchItemDTO {
  id: string;
  topicId: string;
  summary: string;
  keyPoints: string[];
  quotes: Quote[];
  reliability: number;
  relevance: number;
  tags: string[];
  status: string;
  collectedBy: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  source: {
    id: string;
    url: string;
    domain: string;
    title: string | null;
    author: string | null;
    siteName: string | null;
    publishedAt: string | null;
  };
}

function safeParseArray<T>(json: string): T[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function toResearchItemDTO(item: ResearchItemWithRelations): ResearchItemDTO {
  return {
    id: item.id,
    topicId: item.topicId,
    summary: item.summary,
    keyPoints: safeParseArray<string>(item.keyPoints),
    quotes: safeParseArray<Quote>(item.quotes),
    reliability: item.reliability,
    relevance: item.relevance,
    tags: item.tags.map((t) => t.name),
    status: item.status,
    collectedBy: item.collectedBy,
    notes: item.notes,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    source: {
      id: item.source.id,
      url: item.source.url,
      domain: item.source.domain,
      title: item.source.title,
      author: item.source.author,
      siteName: item.source.siteName,
      publishedAt: item.source.publishedAt ? item.source.publishedAt.toISOString() : null,
    },
  };
}
