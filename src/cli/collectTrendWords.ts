// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { prisma } from "../db/client";
import { fetchTrendWords } from "../xPoster/trendWords";

// npm run x-post:collect-trends のエントリポイント。config/x-trend-words.jsonの
// 検索語でXの直近投稿を検索し、よく使われているハッシュタグをTrendWordとして保存する。
// 公式のトレンドAPIはProティア以上が必要で使えないため、代わりにジャンルの投稿検索
// から自前でトレンド情報を作る。既存のTrendWordは毎回全て入れ替える(常に最新の
// スナップショットだけを保持する)。生成されたX投稿は、この結果を「無理に使う必要は
// ない」ヒントとして参照する(generatePost.ts等)。
async function main() {
  const words = await fetchTrendWords();

  await prisma.$transaction([
    prisma.trendWord.deleteMany(),
    ...words.map((w) => prisma.trendWord.create({ data: { word: w.word, occurrences: w.occurrences } })),
  ]);

  console.log(`[x-post] collected ${words.length} trend word(s)`);
  for (const w of words) {
    console.log(`- ${w.word} (${w.occurrences})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
