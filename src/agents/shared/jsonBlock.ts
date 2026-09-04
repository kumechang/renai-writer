import { jsonrepair } from "jsonrepair";

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
    // 記事本文中の強調に全角ではなくASCIIの " を使うなど、Claudeの回答に
    // エスケープ漏れがあるケースが実際に発生した(例: content内の "今" が
    // \"今\" にエスケープされず、JSONとして壊れる)。せっかく長文を貼り直させる
    // のはコストが高いため、まず自動修復を試みてから諦める。
    try {
      const repaired = JSON.parse(jsonrepair(match[1]));
      // jsonrepairは全く JSON でない文字列も強引に文字列値として復元してしまう
      // (例: "abc" → JSONオブジェクトではなく単なる文字列)。この用途では常に
      // オブジェクトを期待しているので、そうでなければ修復失敗として扱う。
      if (typeof repaired !== "object" || repaired === null) {
        throw err;
      }
      return repaired;
    } catch {
      throw new Error(`コードブロックの中身をJSONとして解析できませんでした: ${(err as Error).message}`);
    }
  }
}
