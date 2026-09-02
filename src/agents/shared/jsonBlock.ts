// Claude.aiのコンソールにコピー&ペーストして得た回答テキストから、
// ```json ... ``` (または無印の ``` ... ```) のコードブロックを1つ取り出してJSONとしてパースする。
export function extractJsonBlock(text: string): unknown {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!match) {
    throw new Error(
      "返信の中に ```json ... ``` の形式のコードブロックが見つかりませんでした。" +
        "Claudeの回答をそのまま(コードブロックを含めて)貼り付けてください。"
    );
  }
  try {
    return JSON.parse(match[1]);
  } catch (err) {
    throw new Error(`コードブロックの中身をJSONとして解析できませんでした: ${(err as Error).message}`);
  }
}
