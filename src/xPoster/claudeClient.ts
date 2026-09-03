import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | undefined;

function getClient(): Anthropic {
  if (client) return client;
  // 環境変数 ANTHROPIC_API_KEY を自動で読む(SDKのデフォルト挙動)。
  client = new Anthropic();
  return client;
}

// 1回のメッセージ呼び出しの薄いラッパー(amazon-sentaku-shiageのsrc/claude/client.tsを流用)。
// X投稿文の生成・セルフチェックはツール呼び出しを使わないプレーンなテキスト/JSON応答で足りるため、
// ツール実行ループを持つ src/agents/*/run.ts の呼び出し方とは別に、この薄いラッパーを用意している。
export async function callClaude(model: string, prompt: string): Promise<string> {
  // thinkingを明示的に無効化しないと、拡張思考にmax_tokensの予算を使い切られて
  // 肝心の本文が一切出力されないまま打ち切られることがある
  // (投稿文の作成・チェックというタスクには深い推論は不要なため無効化して問題ない)。
  const response = await getClient().messages.create({
    model,
    max_tokens: 2048,
    thinking: { type: "disabled" },
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(
      `Claude response contained no text block (stop_reason=${response.stop_reason}, content_types=${response.content.map((b) => b.type).join(",")})`
    );
  }
  return textBlock.text;
}
