// 有料部分の区切りマーカーの表記は過去に変更した経緯がある
// (HTMLコメント `<!-- PAID_SECTION -->` → プレーンテキスト `[PAID_SECTION]`)。
// 変更前に執筆・保留中だった原稿は旧表記のまま残っているため、レビュープロンプトが
// 常に最新表記だけを案内すると、実際の原稿の表記と食い違って「マーカーがない」という
// 誤指摘を招く(実例: issue #5)。原稿の中身を見て実際に使われている表記を返す。
export const CURRENT_PAID_SECTION_MARKER = "[PAID_SECTION]";
const LEGACY_PAID_SECTION_MARKERS = ["<!-- PAID_SECTION -->"];

export function detectPaidSectionMarker(content: string): string {
  if (content.includes(CURRENT_PAID_SECTION_MARKER)) {
    return CURRENT_PAID_SECTION_MARKER;
  }
  const legacy = LEGACY_PAID_SECTION_MARKERS.find((marker) => content.includes(marker));
  return legacy ?? CURRENT_PAID_SECTION_MARKER;
}
