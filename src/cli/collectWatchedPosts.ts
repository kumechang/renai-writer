// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { fetchNewPosts } from "../xEngagement/fetchNewPosts";

// npm run x-engagement:collect のエントリポイント。config/x-watch-accounts.jsonに
// 登録したアカウント(「フォロワー1万人以上の憧れのアカウント」5〜10件)の新着投稿を
// X APIから取得し、WatchedPostとして保存する。実際のリプライ生成はgenerateEngagementReplies
// (npm run x-engagement:generate)が別途行う(検知と生成を分けることで、検知は高頻度・
// 生成は1日の上限に沿ったペースで、と別々に制御できるようにしている)。
async function main() {
  const result = await fetchNewPosts();
  console.log(
    `[x-engagement] checked ${result.accountsChecked} account(s), found ${result.newPosts} new post(s)`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
