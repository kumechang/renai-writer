import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as z from "zod/v4";
import { runResearcherOnTopic } from "../researcher/run";

export interface RequestResearchToolConfig {
  apiBaseUrl: string;
  collectedBy: string;
}

const inputSchema = z.object({
  researchTitle: z.string().min(1).describe("調査テーマの短いタイトル"),
  researchBrief: z.string().min(1).describe("調査員に何を調べてほしいかの具体的な依頼内容"),
});

// 編集者・ライターの両方から使う「調査員に依頼する」ツール。
// 新しいTopicを作成し、その場で調査員エージェントを実行して、
// 完了後の調査資料(Markdown)をそのままツール結果として返す。
export function createRequestResearchTool(config: RequestResearchToolConfig) {
  return betaZodTool({
    name: "request_research",
    description:
      "調査員に依頼して、裏付けとなるデータや競合情報などをWebから収集させ、" +
      "結果を要約したMarkdown資料を受け取る。必須ではなく、必要な場合のみ使う。" +
      "完了まで数分かかることがある。",
    inputSchema,
    run: async ({ researchTitle, researchBrief }) => {
      const createRes = await fetch(`${config.apiBaseUrl}/api/topics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: researchTitle, brief: researchBrief }),
      });
      if (!createRes.ok) {
        return `調査テーマの作成に失敗しました (HTTP ${createRes.status}): ${await createRes.text()}`;
      }
      const topic = (await createRes.json()) as { id: string };

      await runResearcherOnTopic(topic.id, {
        apiBaseUrl: config.apiBaseUrl,
        collectedBy: config.collectedBy,
      });

      const briefingRes = await fetch(
        `${config.apiBaseUrl}/api/topics/${topic.id}/briefing?format=markdown`
      );
      if (!briefingRes.ok) {
        return `調査は完了しましたが、資料の取得に失敗しました (HTTP ${briefingRes.status})`;
      }
      return await briefingRes.text();
    },
  });
}
