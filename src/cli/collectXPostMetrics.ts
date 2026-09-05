// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { collectMetrics } from "../xPoster/collectMetrics";

const DAYS = 7;

// GitHub Actions (x-post-collect-metrics.yml、毎日) から実行されるエントリポイント。
// 直近DAYS日分の投稿済みツイートのエンゲージメントを取得し、XPostMetricに記録する。
async function main() {
  const count = await collectMetrics(DAYS);
  console.log(`metrics collected for ${count} post(s)`);
}

main().catch((error) => {
  console.error("collect-x-post-metrics failed", error);
  process.exitCode = 1;
});
