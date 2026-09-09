// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { fetchNewPosts } from "../xEngagement/fetchNewPosts";

// npm run x-engagement:collect のエントリポイント。config/x-watch-accounts.jsonに
// 登録したアカウント(「フォロワー1万人以上の憧れのアカウント」5〜10件)の新着投稿を
// X APIから取得し、見つけ次第、件数を気にせずGitHub issue(Claude.aiのチャットに
// 貼り付けるリプライ検討プロンプト)を作る。Claude APIは呼ばないため、issueを何件
// 作ってもAPI使用量は増えない。
async function main() {
  const result = await fetchNewPosts();
  console.log(
    `[x-engagement] checked ${result.accountsChecked} account(s), found ${result.newPosts} new post(s), created ${result.issuesCreated} issue(s)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
