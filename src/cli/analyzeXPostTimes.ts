// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { loadXPosterConfig } from "../xPoster/config";
import { analyzePostingTimes } from "../xPoster/analyzePostingTimes";

// GitHub Actions (x-post-analyze-posting-times.yml、週次) から実行されるエントリポイント。
// 蓄積されたエンゲージメント実績をClaudeに分析させ、PostingTimeWeightを更新する。
// これがshouldGenerateNowの「時間帯の重み」として、次回以降の生成タイミングに反映される。
async function main() {
  const config = loadXPosterConfig();
  await analyzePostingTimes(config);
}

main().catch((error) => {
  console.error("analyze-x-post-times failed", error);
  process.exitCode = 1;
});
