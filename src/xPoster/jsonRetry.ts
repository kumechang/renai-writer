import type { ZodType } from "zod";
import { callClaude } from "./claudeClient";

// セルフチェックはJSON出力必須のため、このモジュールで共通化している
// (amazon-sentaku-shiageのsrc/claude/jsonRetry.tsを流用)。
const JSON_ONLY_REMINDER =
  "\n\n# 重要\n出力はJSONのみとしてください。前置き・説明・コードブロック記法(```)は一切含めないでください。";

// 前置き文などJSON以外のテキストが混ざっても救えるよう、まず素の parse を試し、
// 失敗したら最初の { から最後の } までを抜き出して再試行する。
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no JSON object found in Claude response");
    return JSON.parse(match[0]);
  }
}

// JSON期待の呼び出し + zod検証。パース/検証に失敗したら「JSONのみ出力」を
// 強調した1回だけの再試行を行い、それでも駄目なら例外を投げて処理を失敗させる
// (壊れた投稿データを黙ってDBに残さないため)。
export async function callClaudeJson<T>(
  model: string,
  prompt: string,
  schema: ZodType<T>
): Promise<{ raw: string; data: T }> {
  const firstAttempt = await callClaude(model, prompt);
  try {
    const parsed = extractJson(firstAttempt);
    return { raw: firstAttempt, data: schema.parse(parsed) };
  } catch (firstError) {
    const secondAttempt = await callClaude(model, prompt + JSON_ONLY_REMINDER);
    try {
      const parsed = extractJson(secondAttempt);
      return { raw: secondAttempt, data: schema.parse(parsed) };
    } catch (secondError) {
      throw new Error(
        `Claude JSON output could not be parsed after retry: ${String(secondError)} (first attempt error: ${String(firstError)})`
      );
    }
  }
}
