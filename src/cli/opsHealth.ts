try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { appendFileSync } from "node:fs";
import { prisma } from "../db/client";
import { createIssue } from "../lib/github";
import { parseGithubRepository } from "../xPoster/env";
import { collectFollowerTrend } from "../xPoster/accountSnapshot";
import {
  buildHealthReport,
  collectOutputCounts,
  collectShowcasePosts,
  countAlerts,
  evaluateChecks,
  fetchFailedRunCounts,
  loadOpsHealthConfig,
} from "../ops/healthCheck";

export const OPS_HEALTH_LABEL = "ops-health";

// npm run ops:health のエントリポイント。各処理の直近の出力件数と、GitHub Actionsの失敗を集計し、
// レポートを標準出力(とGitHub Actionsのステップサマリー)に出す。要確認が1件でもあれば、issueを作る。
async function main() {
  const config = loadOpsHealthConfig();
  const now = new Date();
  const since = new Date(now.getTime() - config.windowDays * 24 * 60 * 60 * 1000);

  const counts = await collectOutputCounts(since);
  const results = evaluateChecks(config.checks, counts);

  const repo = parseGithubRepository();
  const failedRuns = repo ? await fetchFailedRunCounts(repo.owner, repo.repo, since, process.env.GITHUB_TOKEN) : null;

  const showcase = await collectShowcasePosts(10);
  const followerTrend = await collectFollowerTrend(14, now);
  const report = buildHealthReport({ now, windowDays: config.windowDays, results, failedRuns, showcase, followerTrend });
  console.log(report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${report}\n`);

  const alerts = countAlerts(results, failedRuns);
  if (alerts > 0 && repo && process.env.GITHUB_TOKEN) {
    const issue = await createIssue(
      repo.owner,
      repo.repo,
      `[ops-health] 要確認 ${alerts}件(${now.toISOString().slice(0, 10)})`,
      report,
      [OPS_HEALTH_LABEL]
    );
    console.log(`[ops-health] created issue ${issue.url}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
