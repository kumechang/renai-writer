import type { XPosterConfig } from "./config";

// 記事紹介(promo)投稿を、自動選択のときに試すかどうかを決める。
// 記事URLが無い記事紹介は、「記事の存在だけを伝える」「公開前の記事を匂わせる」形になりやすく、
// 「1件目だけで完結する」ルールとぶつかって、ほとんどが不合格(承認待ち)になっていた。
// そのため既定では、自動選択では記事紹介を作らない(記事URL付きスレッドと、記事に紐づかない
// 単発・保存型の投稿で足りる)。記事を指定した手動実行(articleId指定)は、この判定の対象外。
export function wantsArticlePromo(
  config: Pick<XPosterConfig, "autoArticlePromoEnabled" | "standalonePostRatio">,
  random: () => number = Math.random
): boolean {
  if (!config.autoArticlePromoEnabled) return false;
  return random() >= config.standalonePostRatio;
}
