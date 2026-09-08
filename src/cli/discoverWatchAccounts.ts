// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { discoverAccounts } from "../xEngagement/discoverAccounts";
import { createDiscoveryIssue } from "../xEngagement/discoveryIssue";
import { parseGithubRepository } from "../xPoster/env";

// npm run x-engagement:discover のエントリポイント。config/x-engagement-discovery.json の
// 検索キーワードでXの直近投稿を検索し、フォロワー数の多い投稿者(config/x-watch-accounts.json
// に未登録のアカウント)を候補としてGitHub issueにまとめる。「フォロワー1万人以上の
// 憧れのアカウントを5〜10人フォローする」という最初のステップを、手作業での選定なしに
// 始められるようにするための一回限りの探索コマンド(定期実行ではなく、必要なときに手動で叩く想定)。
async function main() {
  const candidates = await discoverAccounts();

  console.log(`found ${candidates.length} candidate account(s):`);
  for (const c of candidates) {
    console.log(`- @${c.username} (${c.name}) — ${c.followersCount.toLocaleString()} followers`);
  }

  const repo = parseGithubRepository();
  if (!repo || !process.env.GITHUB_TOKEN) {
    console.log("GITHUB_TOKEN/GITHUB_REPOSITORY未設定のためissueは作成していません(コンソール出力のみ)。");
    return;
  }

  const issue = await createDiscoveryIssue(repo.owner, repo.repo, candidates);
  console.log(`created issue: ${issue.url}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
