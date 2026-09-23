import { z } from "zod";
import { loadConfigDoc } from "./promptLoader";

// 想定読者ペルソナごとの「この投稿をブックマークするか」の判定。これまでの投稿は
// 共感やいいねは得られても保存(ブックマーク)が1件も付いておらず、フォローに
// 結びついていなかったため、投稿前にペルソナ視点で保存されるかを確認する。
// モデルが出力し忘れても他の採点結果まで捨てないよう、欠落時は空配列にする。
export const bookmarkReviewSchema = z
  .array(
    z.object({
      persona: z.string(),
      would_bookmark: z.boolean(),
      reason: z.string(),
    })
  )
  .default([]);

export type BookmarkReview = z.infer<typeof bookmarkReviewSchema>;

export function loadReaderPersonas(): string {
  return loadConfigDoc("x_reader_personas.md");
}

// セルフチェックのプロンプトに埋め込む判定指示。affectsScoreがfalseの場合は参考情報として
// 記録するだけにし、既存の投稿種別(共感・続きが気になる導入を狙う設計)の採点基準は変えない。
export function buildBookmarkReviewSection(personas: string, affectsScore: boolean): string {
  const scoringNote = affectsScore
    ? "この判定は採点に含めてください。どのペルソナも保存しない判定の場合は不合格とし、" +
      "少なくとも1人が保存したくなるように修正した本文を作成してください。"
    : "この判定は参考情報として記録するものです。総合評価(score)や合否には含めないでください。";

  return [
    "# 保存(ブックマーク)判定",
    "",
    "以下の想定読者ペルソナそれぞれになりきって、この投稿をXのタイムラインで見かけたとき、",
    "後で見返すためにブックマークするかどうかを判定してください。",
    "「いいねしたくなるか」ではなく「手元に残しておきたいか」で判定してください。",
    "共感できるだけの投稿や、続きが気になるだけで途中で切れている投稿は、保存しない判定になるのが普通です。",
    "",
    personas.trim(),
    "",
    "判定結果は`bookmark_review`に、ペルソナごとに1件ずつ入れてください",
    "(persona: ペルソナ名、would_bookmark: 保存するか、reason: 理由を1文で)。",
    scoringNote,
  ].join("\n");
}

export function countBookmarkers(review: BookmarkReview): number {
  return review.filter((verdict) => verdict.would_bookmark).length;
}
