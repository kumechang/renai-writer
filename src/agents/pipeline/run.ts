import { fetchJson } from "../shared/http";
import type { AgentRunConfig, PlanResponse } from "../shared/types";
import { runEditorPlanning, runEditorReview } from "../editor/run";
import { runWriterDraft, runWriterRevision } from "../writer/run";

// 差し戻しは2回目まで許容する(初稿+2回の修正=最大3回のレビュー)
const MAX_REVISIONS = 2;

export interface PipelineResult {
  planId: string;
  finalDraftId: string;
  finalScore: number;
  finalStatus: string;
}

async function patchPlan(
  apiBaseUrl: string,
  planId: string,
  data: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`${apiBaseUrl}/api/plans/${planId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    throw new Error(`Planの更新に失敗しました: ${res.status} ${await res.text()}`);
  }
}

// 編集者の企画立案 -> ライターの執筆 -> 編集者のレビュー -> (必要なら)ライターの修正
// を、差し戻し2回までのルールに従って一気通貫で実行する。
export async function runArticlePipeline(
  theme: string,
  config: AgentRunConfig,
  log: (message: string) => void = console.log
): Promise<PipelineResult> {
  log("=== 編集者: 企画立案 ===");
  const planning = await runEditorPlanning(theme, config);
  log(planning.summary);

  await patchPlan(config.apiBaseUrl, planning.planId, { status: "drafting" });

  log("=== ライター: 初稿執筆 ===");
  let draft = await runWriterDraft(planning.planId, config);
  log(draft.summary);

  let revisionCount = 0;
  let finalScore = 0;

  while (true) {
    await patchPlan(config.apiBaseUrl, planning.planId, { status: "in_review" });
    const isFinalAttempt = revisionCount >= MAX_REVISIONS;

    log(`=== 編集者: レビュー (revision ${draft.revisionNumber}) ===`);
    const review = await runEditorReview(planning.planId, draft.draftId, isFinalAttempt, config);
    log(review.summary);
    finalScore = review.score;

    if (review.score >= 80) {
      await patchPlan(config.apiBaseUrl, planning.planId, { status: "accepted" });
      break;
    }

    if (isFinalAttempt) {
      const status = review.score > 70 ? "accepted_with_reservation" : "needs_human_review";
      await patchPlan(config.apiBaseUrl, planning.planId, { status });
      break;
    }

    revisionCount += 1;
    log(`=== ライター: 修正 (${revisionCount}回目) ===`);
    await patchPlan(config.apiBaseUrl, planning.planId, { status: "needs_revision" });
    draft = await runWriterRevision(
      planning.planId,
      draft.draftId,
      revisionCount >= MAX_REVISIONS,
      config
    );
    log(draft.summary);
  }

  const finalPlan = await fetchJson<PlanResponse>(
    `${config.apiBaseUrl}/api/plans/${planning.planId}`
  );

  return {
    planId: planning.planId,
    finalDraftId: draft.draftId,
    finalScore,
    finalStatus: finalPlan.status,
  };
}
