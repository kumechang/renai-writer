// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { generateEngagementReply } from "../xEngagement/pipeline";
import { loadXEngagementConfig } from "../xEngagement/config";
import { isWithinReplyWindow } from "../xEngagement/replyWindow";

// npm run x-engagement:generate のエントリポイント。ウォッチ対象アカウントの
// 未対応投稿(WatchedPost, status: "new")のうち、投稿から時間が経ちすぎていないものを
// 1件選び、心のこもった(かつ有益な)リプライを生成してGitHub issueでの確認待ちにする
// (approvalMode: autoの場合はセルフチェック合格時にその場で下書きを確定する)。
// X APIの自動化ルール上、自分宛てのメンションでない投稿への自動リプライ投稿はできない
// ため、実際にXへ投稿するのは運用者がissueの文面を見て手動で行う(このコマンド・
// ワークフローはAPI経由での投稿は一切行わない)。
// 1日の上限(maxRepliesPerDay)・直近生成からの間隔(minSpacingMinutes)・生成可能時間帯
// (replyWindow)による制御があるため、頻繁に起動しても実際に生成される回数は
// 「毎日3〜5回」程度のペースに保たれる。対象が無い場合は何もせず終了する。
async function main() {
  const config = loadXEngagementConfig();
  const now = new Date();

  if (!isWithinReplyWindow(now, config)) {
    console.log("[x-engagement] リプライ可能時間帯の外なのでスキップします。");
    return;
  }

  const result = await generateEngagementReply(now);
  if (!result) {
    console.log("[x-engagement] 今回はリプライ対象がない、またはペース制御によりスキップしました。");
    return;
  }

  console.log(
    `[x-engagement] @${result.authorUsername}への返信を生成しました(status=${result.status}, スコア=${result.score}点)`
  );
  console.log("---");
  console.log(result.finalText);
  console.log("---");
  if (result.githubIssueUrl) {
    console.log(`承認issue: ${result.githubIssueUrl}`);
  } else {
    console.log("GITHUB_TOKEN未設定のため承認issueは作成していません(DB上にのみ記録)。");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
