// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { findReplyCandidates } from "../xEngagement/findReplyCandidates";

// npm run x-engagement:collect のエントリポイント。特定アカウントの監視ではなく、
// 恋愛・婚活ジャンルのキーワード検索(1回のAPI呼び出しのみ、ユーザー情報は取得しない)で
// 直近の投稿を取得し、インプレッション数が閾値を超えているものだけ(1ユーザーあたり1件)を
// GitHub issue(Claude.aiのチャットに貼り付けるリプライ検討プロンプト)にする。
// Claude APIは呼ばないため、issueを何件作ってもAPI使用量は増えない。
async function main() {
  const result = await findReplyCandidates();
  console.log(
    `[x-engagement] fetched ${result.fetched} post(s), ${result.qualifying} above impression threshold, created ${result.issuesCreated} issue(s)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
