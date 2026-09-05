import type { XPosterConfig } from "./config";
import { listLatestEngagementSamples } from "./metrics";
import { upsertWeights } from "./postingTimeWeights";
import { analyzePostingTimesWithClaude } from "./analyzePostingTimesClaude";
import { getJstHour } from "./time";

// データが薄いうちに分析すると、たまたま良かった/悪かった1〜2件で重みが極端に振れてしまう。
// ある程度の母数が貯まるまでは分析自体をスキップし、既定値(均等)のまま運用する
// (amazon-sentaku-shiageのpipeline/analyzePostingTimes.tsを流用)。
const MIN_SAMPLES = 10;

// 週次でXPostMetricを時間帯別に集計し、Claudeに分析させてPostingTimeWeightを更新する。
export async function analyzePostingTimes(config: XPosterConfig): Promise<void> {
  const samples = await listLatestEngagementSamples();
  if (samples.length < MIN_SAMPLES) {
    console.log(
      `[x-poster] not enough posted+metriced posts yet (count=${samples.length}, required=${MIN_SAMPLES}), skipping posting-time analysis`
    );
    return;
  }

  const byHour = new Map<number, { total: number; count: number }>();
  for (const sample of samples) {
    const hour = getJstHour(sample.postedAt);
    const bucket = byHour.get(hour) ?? { total: 0, count: 0 };
    bucket.total += sample.engagementRate;
    bucket.count += 1;
    byHour.set(hour, bucket);
  }

  const statsLines = [...byHour.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(
      ([hour, { total, count }]) =>
        `${hour}時台: 投稿${count}件, 平均エンゲージメント率${((total / count) * 100).toFixed(2)}%`
    );

  const result = await analyzePostingTimesWithClaude(config.claudeModel, statsLines.join("\n"));
  await upsertWeights(result.weights);
  console.log(`[x-poster] posting-time weights updated (hours=${result.weights.length})`);
}
