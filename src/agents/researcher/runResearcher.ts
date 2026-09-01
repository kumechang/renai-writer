// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { runResearcherOnTopic } from "./run";

// 調査員(Claude)を1テーマ分だけ実行するCLIエントリポイント。
// 事前に renai-writer のAPIサーバー(npm run dev)を起動しておく必要がある。
async function main() {
  const topicId = process.argv[2];
  if (!topicId) {
    console.error("使い方: npm run researcher -- <topicId>");
    process.exit(1);
  }

  const apiBaseUrl = process.env.RESEARCH_API_BASE_URL ?? "http://localhost:3000";
  const collectedBy = process.env.RESEARCHER_AGENT_NAME ?? "claude-researcher-agent";

  const summary = await runResearcherOnTopic(topicId, { apiBaseUrl, collectedBy });
  console.log(summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
