// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import Anthropic from "@anthropic-ai/sdk";
import { buildResearcherSystemPrompt } from "./systemPrompt";
import { createSubmitResearchItemTool, webFetchTool, webSearchTool } from "./tools";

const MODEL = "claude-opus-5";

interface TopicResponse {
  id: string;
  title: string;
  theme: string | null;
  brief: string | null;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} に失敗しました: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

// 調査員(Claude)を1テーマ分だけ実行するCLIエントリポイント。
// 事前に renai-writer のAPIサーバー(npm run dev)を起動しておく必要がある。
async function main() {
  const topicId = process.argv[2];
  if (!topicId) {
    console.error("使い方: npm run researcher -- <topicId>");
    process.exit(1);
  }

  const apiBaseUrl = process.env.RESEARCH_API_BASE_URL ?? "http://localhost:3000";
  const collectedBy = process.env.RESEARCHER_AGENT_NAME ?? "claude-researcher-agent";

  const topic = await fetchJson<TopicResponse>(`${apiBaseUrl}/api/topics/${topicId}`);
  const existingTags = await fetchJson<Array<{ name: string }>>(`${apiBaseUrl}/api/tags`);

  const systemPrompt = buildResearcherSystemPrompt(topic, existingTags.map((t) => t.name));
  const submitResearchItemTool = createSubmitResearchItemTool({ topicId, apiBaseUrl, collectedBy });

  const client = new Anthropic();

  const params = {
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" as const },
    system: systemPrompt,
    tools: [webSearchTool, webFetchTool, submitResearchItemTool],
    messages: [
      {
        role: "user" as const,
        content: `「${topic.title}」というテーマについてWeb調査を行い、集めた情報を submit_research_item ツールで登録してください。`,
      },
    ],
  };

  const runner = client.beta.messages.toolRunner({ ...params, stream: true });

  // 長時間の調査でサーバー側ツール呼び出し回数上限により pause_turn が返ることがあるため、
  // その場合は直前のassistantターンを積み戻して継続する。
  for await (const stream of runner) {
    const message = await stream.finalMessage();
    if (message.stop_reason === "pause_turn") {
      runner.pushMessages({ role: "assistant", content: message.content });
    }
  }

  const finalMessage = await runner.done();
  for (const block of finalMessage.content) {
    if (block.type === "text") {
      console.log(block.text);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
