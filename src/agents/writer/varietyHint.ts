import { fetchJson } from "../shared/http";
import { detectPaidSectionMarker } from "../shared/paidSectionMarker";
import type { ArticleResponse, DraftResponse } from "../shared/types";

const OPENING_CHARS = 300;

export interface SiblingArticleDraft {
  title: string;
  content: string;
}

// 同じ企画(Plan)から生成される記事は、共通の企画(場面設定や結論)をもとに書くため、
// 特に対策をしないと書き出しのシーンやキメ台詞が使い回しのように似てしまう
// (実例: 恋愛の執着をテーマにした企画で、公開済み3記事の無料部分の書き出しと
// キメ台詞がほぼ同じになってしまった)。xPosterのbuildVarietyHint(過去の投稿を
// 避けるヒント)と同じ発想で、同じ企画の他記事の書き出しをプロンプトに渡し、
// 書き出しや決め台詞を使い回さないよう促す。
export function formatArticleVarietyHint(siblings: SiblingArticleDraft[]): string | null {
  const openings = siblings
    .map((sibling) => {
      const marker = detectPaidSectionMarker(sibling.content);
      const freePart = sibling.content.split(marker)[0].trim();
      if (!freePart) return null;
      const truncated =
        freePart.length > OPENING_CHARS ? `${freePart.slice(0, OPENING_CHARS)}…` : freePart;
      return `- 「${sibling.title}」: ${truncated}`;
    })
    .filter((line): line is string => line !== null);

  if (openings.length === 0) return null;

  return [
    "同じ企画から複数の記事を作っています。下記は既に書かれた他の記事の書き出し(無料部分の" +
      "冒頭)です。同じ場面設定・同じ言い回し・同じキメ台詞を繰り返さないでください" +
      "(結論や主張が重なるのは構いませんが、表現・エピソード・書き出しは変えてください):",
    "",
    ...openings,
  ].join("\n");
}

// planIdの他の記事(excludeArticleId以外)について、直近の原稿があればその書き出しを
// 集めてヒント文にする。まだ1本も書かれていない記事(下書きが無い)は無視する。
export async function buildArticleVarietyHint(
  apiBaseUrl: string,
  planId: string,
  excludeArticleId: string
): Promise<string | null> {
  const articles = await fetchJson<ArticleResponse[]>(`${apiBaseUrl}/api/plans/${planId}/articles`);

  const siblings: SiblingArticleDraft[] = [];
  for (const article of articles) {
    if (article.id === excludeArticleId) continue;
    const drafts = await fetchJson<DraftResponse[]>(
      `${apiBaseUrl}/api/plans/${planId}/articles/${article.id}/drafts`
    );
    const latest = drafts[drafts.length - 1];
    if (latest) siblings.push({ title: article.title, content: latest.content });
  }

  return formatArticleVarietyHint(siblings);
}
