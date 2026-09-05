import { z } from "zod";
import { callClaudeJson } from "./jsonRetry";

const weightEntrySchema = z.object({
  hour: z.number().int().min(0).max(23),
  weight: z.number().min(0.1).max(3),
  reason: z.string(),
});

export const analyzePostingTimesSchema = z.object({
  weights: z.array(weightEntrySchema),
});

export type AnalyzePostingTimesResult = z.infer<typeof analyzePostingTimesSchema>;

// 運用最適化専用の単発Claude呼び出し。時間帯別の投稿実績・エンゲージメント集計から、
// 次回以降shouldGenerateNowが参照する「時間帯ごとの投稿重み」を算出させる
// (amazon-sentaku-shiageのclaude/analyzePostingTimes.tsを流用)。
export async function analyzePostingTimesWithClaude(
  model: string,
  statsText: string
): Promise<AnalyzePostingTimesResult> {
  const prompt = [
    "あなたはSNS運用データの分析担当です。",
    "以下は、恋愛(執着・未練の手放し方などをテーマにした)メディアのXアカウントにおける、",
    "投稿時刻(JST、0〜23時)ごとの投稿件数と平均エンゲージメント率",
    "(いいね+リポスト+返信 / インプレッション)の集計です。",
    "",
    statsText,
    "",
    "# タスク",
    "この集計をもとに、各時間帯の投稿優先度を「重み」として算出してください。",
    "重みが高いほど、その時間帯に投稿する確率が上がります。",
    "",
    "# 注意点",
    "- 平均的な時間帯の重みは1.0を基準にしてください。",
    "- 投稿件数が少ない時間帯は、外れ値に引きずられないよう重みを1.0に近づけてください。",
    "- 重みの範囲は0.1〜3.0としてください。",
    "- 集計に含まれる時間帯についてのみ出力してください。",
    "",
    "# 出力",
    "JSONのみを出力してください。",
    "",
    '{ "weights": [ { "hour": 0, "weight": 1.0, "reason": "" } ] }',
  ].join("\n");

  const { data } = await callClaudeJson(model, prompt, analyzePostingTimesSchema);
  return data;
}
