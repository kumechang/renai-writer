import Anthropic from "@anthropic-ai/sdk";
import { fetchJson } from "../shared/http";
import { extractText } from "../shared/anthropic";
import { buildResearcherSystemPrompt } from "./systemPrompt";
import { createSubmitResearchItemTool, webFetchTool, webSearchTool } from "./tools";

const MODEL = "claude-opus-5";

interface TopicResponse {
  id: string;
  title: string;
  theme: string | null;
  brief: string | null;
}

export interface RunResearcherOptions {
  apiBaseUrl: string;
  collectedBy: string;
}

// 指定したTopicに対して調査員エージェントを1回実行し、最後の要約テキストを返す。
// 編集者/ライターの request_research ツールからも呼び出される。
export async function runResearcherOnTopic(
  topicId: string,
  options: RunResearcherOptions
): Promise<string> {
  const { apiBaseUrl, collectedBy } = options;

  const topic = await fetchJson<TopicResponse>(`${apiBaseUrl}/api/topics/${topicId}`);
  const existingTags = await fetchJson<Array<{ name: string }>>(`${apiBaseUrl}/api/tags`);

  const systemPrompt = buildResearcherSystemPrompt(topic, existingTags.map((t) => t.name));
  const submitResearchItemTool = createSubmitResearchItemTool({ topicId, apiBaseUrl, collectedBy });

  const client = new Anthropic();

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: systemPrompt,
    tools: [webSearchTool, webFetchTool, submitResearchItemTool],
    messages: [
      {
        role: "user",
        content: `「${topic.title}」というテーマについてWeb調査を行い、集めた情報を submit_research_item ツールで登録してください。`,
      },
    ],
    stream: true,
  });

  // 長時間の調査でサーバー側ツールの呼び出し回数上限に達すると pause_turn が返る
  // ことがあるため、その場合は直前のassistantターンを積み戻して継続する。
  for await (const stream of runner) {
    const message = await stream.finalMessage();
    if (message.stop_reason === "pause_turn") {
      runner.pushMessages({ role: "assistant", content: message.content });
    }
  }

  const finalMessage = await runner.done();
  return extractText(finalMessage);
}
