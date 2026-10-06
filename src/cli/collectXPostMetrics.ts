// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { collectMetrics } from "../xPoster/collectMetrics";
import { recordAccountSnapshot } from "../xPoster/accountSnapshot";

const DAYS = 7;

// GitHub Actions (x-post-collect-metrics.yml、毎日) から実行されるエントリポイント。
// 直近DAYS日分の投稿済みツイートのエンゲージメントを取得し、XPostMetricに記録する。
// あわせて、アカウントのフォロワー数を、日次のスナップショットとして記録する(どちらかが失敗しても、
// もう一方は実行する)。
async function main() {
  let failed = false;

  try {
    const count = await collectMetrics(DAYS);
    console.log(`metrics collected for ${count} post(s)`);
  } catch (error) {
    failed = true;
    console.error("collect-x-post-metrics failed", error);
  }

  try {
    await recordAccountSnapshot();
  } catch (error) {
    failed = true;
    console.error("record-account-snapshot failed", error);
  }

  if (failed) process.exitCode = 1;
}

main();
