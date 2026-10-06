try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { prisma } from "../db/client";
import { recordAccountSnapshot, saveAccountSnapshot } from "../xPoster/accountSnapshot";

const USAGE =
  "使い方:\n" +
  "  npm run x-account:snapshot\n" +
  "    → X APIから今のフォロワー数などを取得して、今日の分として記録する(毎日の指標収集でも自動で記録される)。\n" +
  "  npm run x-account:snapshot -- --date 2026-09-28 --followers 25 [--following 27]\n" +
  "    → 過去の日の値を手で入れる(通知やアナリティクスの数字から、後から補うとき用)。";

function getArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

async function main() {
  const argv = process.argv.slice(2);
  const date = getArg(argv, "--date");
  const followers = getArg(argv, "--followers");
  const following = getArg(argv, "--following");

  if (date === undefined && followers === undefined) {
    await recordAccountSnapshot();
    return;
  }
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || followers === undefined || !/^\d+$/.test(followers)) {
    throw new Error(USAGE);
  }
  const snapshot = await saveAccountSnapshot({
    capturedOn: date,
    followers: Number(followers),
    following: following !== undefined && /^\d+$/.test(following) ? Number(following) : null,
    source: "manual",
  });
  console.log(`saved ${snapshot.capturedOn}: followers=${snapshot.followers} (manual)`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
