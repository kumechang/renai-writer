import { fetchJson } from "../shared/http";
import type { AgentRunConfig, ArticleResponse } from "../shared/types";
import { runEditorPlanning, runEditorReview } from "../editor/run";
import { runWriterDraft, runWriterRevision } from "../writer/run";

// 差し戻しは2回目まで許容する(初稿+2回の修正=最大3回のレビュー)
const MAX_REVISIONS = 2;

export interface PipelineResult {
  planId: string;
  articleId: string;
  finalDraftId: string;
  finalScore: number;
  finalStatus: string;
}

async function patchArticle(
  apiBaseUrl: string,
  planId: string,
  articleId: string,
  data: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/api/plans/${planId}/articles/${articleId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(`Articleの更新に失敗しました: ${res.status} ${await res.text()}`);
  }
}

// 編集者の企画立案(推奨タイトル1つ目でArticleも作成) -> ライターの執筆 -> 編集者のレビュー ->
// (必要なら)ライターの修正 を、差し戻し2回までのルールに従って一気通貫で実行する。
// 自動実行パイプラインは1記事のみを書く(複数記事を書きたい場合はコンソール駆動フローを使う)。
export async function runArticlePipeline(
  theme: string,
  config: AgentRunConfig,
  log: (message: string) => void = console.log
): Promise<PipelineResult> {
  log("=== 編集者: 企画立案 ===");
  const planning = await runEditorPlanning(theme, config);
  log(planning.summary);

  log(`=== ライター: 初稿執筆 (${planning.title}) ===`);
  let draft = await runWriterDraft(planning.planId, planning.articleId, config);
  log(draft.summary);

  let revisionCount = 0;
  let finalScore = 0;

  while (true) {
    await patchArticle(config.apiBaseUrl, planning.planId, planning.articleId, {
      status: "in_review",
    });
    const isFinalAttempt = revisionCount >= MAX_REVISIONS;

    log(`=== 編集者: レビュー (revision ${draft.revisionNumber}) ===`);
    const review = await runEditorReview(
      planning.planId,
      planning.articleId,
      draft.draftId,
      isFinalAttempt,
      config
    );
    log(review.summary);
    finalScore = review.score;

    if (review.score >= 80) {
      await patchArticle(config.apiBaseUrl, planning.planId, planning.articleId, {
        status: "accepted",
      });
      break;
    }

    if (isFinalAttempt) {
      const status = review.score > 70 ? "accepted_with_reservation" : "needs_human_review";
      await patchArticle(config.apiBaseUrl, planning.planId, planning.articleId, { status });
      break;
    }

    revisionCount += 1;
    log(`=== ライター: 修正 (${revisionCount}回目) ===`);
    await patchArticle(config.apiBaseUrl, planning.planId, planning.articleId, {
      status: "needs_revision",
    });
    draft = await runWriterRevision(
      planning.planId,
      planning.articleId,
      draft.draftId,
      revisionCount >= MAX_REVISIONS,
      config
    );
    log(draft.summary);
  }

  const finalArticle = await fetchJson<ArticleResponse>(
    `${config.apiBaseUrl}/api/plans/${planning.planId}/articles/${planning.articleId}`
  );

  return {
    planId: planning.planId,
    articleId: planning.articleId,
    finalDraftId: draft.draftId,
    finalScore,
    finalStatus: finalArticle.status,
  };
}
