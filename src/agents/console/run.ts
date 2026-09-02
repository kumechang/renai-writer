import { z } from "zod";
import type { IssueSession } from "@prisma/client";
import { prisma } from "../../db/client";
import { fetchGithubIssue, listIssueComments, postIssueComment } from "../../lib/github";
import { fetchJson } from "../shared/http";
import { extractJsonBlock } from "../shared/jsonBlock";
import type { DraftResponse, PlanResponse } from "../shared/types";
import { createPlanSchema } from "../../schemas/plan";
import { createDraftSchema } from "../../schemas/draft";
import { createReviewSchema } from "../../schemas/review";
import { createResearchItemSchema } from "../../schemas/researchItem";
import { buildEditorPlanningConsolePrompt, buildEditorReviewConsolePrompt } from "../editor/consolePrompt";
import { buildWriterDraftConsolePrompt, buildWriterRevisionConsolePrompt } from "../writer/consolePrompt";
import { buildResearcherConsolePrompt } from "../researcher/consolePrompt";
import { formatArticleComment } from "../pipeline/formatComment";

// 差し戻しは2回目まで許容する(初稿+修正2回=最大3原稿・3回のレビュー)
const MAX_REVISIONS = 2;

export interface IssueRef {
  owner: string;
  repo: string;
  number: number;
}

const researchReplySchema = z.object({
  items: z.array(createResearchItemSchema.omit({ collectedBy: true })),
});

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`POST ${url} に失敗しました: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`PATCH ${url} に失敗しました: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function findLatestDraft(apiBaseUrl: string, planId: string): Promise<DraftResponse> {
  const drafts = await fetchJson<DraftResponse[]>(`${apiBaseUrl}/api/plans/${planId}/drafts`);
  const latest = drafts[drafts.length - 1];
  if (!latest) throw new Error("原稿がまだ登録されていません(内部エラー)");
  return latest;
}

function whereIssue(issueRef: IssueRef) {
  return {
    issueOwner_issueRepo_issueNumber: {
      issueOwner: issueRef.owner,
      issueRepo: issueRef.repo,
      issueNumber: issueRef.number,
    },
  };
}

function issueRefLabel(issueRef: IssueRef): string {
  return `${issueRef.owner}/${issueRef.repo}#${issueRef.number}`;
}

// 調査員への依頼プロンプトをissueに投稿し、返信待ち状態にする。
export async function startResearch(
  issueRef: IssueRef,
  title: string,
  brief: string,
  apiBaseUrl: string
): Promise<string> {
  const existing = await prisma.issueSession.findUnique({ where: whereIssue(issueRef) });
  if (existing?.pendingStep) {
    throw new Error(
      `このissueには既に返信待ちのプロンプト(${existing.pendingStep})があります。先にそちらを解決してください。`
    );
  }

  const topic = await postJson<{ id: string; title: string }>(`${apiBaseUrl}/api/topics`, {
    title,
    brief,
  });

  const prompt = buildResearcherConsolePrompt({ title: topic.title, brief });
  const comment = await postIssueComment(issueRef.owner, issueRef.repo, issueRef.number, prompt);

  await prisma.issueSession.upsert({
    where: whereIssue(issueRef),
    create: {
      issueOwner: issueRef.owner,
      issueRepo: issueRef.repo,
      issueNumber: issueRef.number,
      topicId: topic.id,
      pendingStep: "research",
      pendingPromptCommentId: BigInt(comment.id),
    },
    update: {
      topicId: topic.id,
      pendingStep: "research",
      pendingPromptCommentId: BigInt(comment.id),
    },
  });

  return (
    `調査員への依頼プロンプトをissue ${issueRefLabel(issueRef)} に投稿しました。\n` +
    `Claude.aiのコンソールに貼り付けて実行し、回答をissueにコメントとして貼り付けたら、\n` +
    `npm run console -- check --issue ${issueRefLabel(issueRef)} を実行してください。`
  );
}

// 編集者の企画立案プロンプトをissueに投稿し、返信待ち状態にする。
export async function startPlan(issueRef: IssueRef, apiBaseUrl: string): Promise<string> {
  const existing = await prisma.issueSession.findUnique({ where: whereIssue(issueRef) });
  if (existing?.pendingStep) {
    throw new Error(
      `このissueには既に返信待ちのプロンプト(${existing.pendingStep})があります。先にそちらを解決してください。`
    );
  }
  if (existing?.planId) {
    throw new Error("このissueには既に企画が登録されています。");
  }

  const issue = await fetchGithubIssue(issueRef.owner, issueRef.repo, issueRef.number);
  const theme = `${issue.title}\n\n${issue.body}`;

  let researchBriefing: string | undefined;
  if (existing?.topicId) {
    const res = await fetch(`${apiBaseUrl}/api/topics/${existing.topicId}/briefing?format=markdown`);
    if (res.ok) researchBriefing = await res.text();
  }

  const prompt = buildEditorPlanningConsolePrompt(theme, researchBriefing);
  const comment = await postIssueComment(issueRef.owner, issueRef.repo, issueRef.number, prompt);

  await prisma.issueSession.upsert({
    where: whereIssue(issueRef),
    create: {
      issueOwner: issueRef.owner,
      issueRepo: issueRef.repo,
      issueNumber: issueRef.number,
      pendingStep: "plan",
      pendingPromptCommentId: BigInt(comment.id),
    },
    update: {
      pendingStep: "plan",
      pendingPromptCommentId: BigInt(comment.id),
    },
  });

  return (
    `編集者への企画立案プロンプトをissue ${issueRefLabel(issueRef)} に投稿しました。\n` +
    `Claude.aiのコンソールに貼り付けて実行し、回答をissueにコメントとして貼り付けたら、\n` +
    `npm run console -- check --issue ${issueRefLabel(issueRef)} を実行してください。`
  );
}

// issueの保留中プロンプトに対する返信を確認し、あれば処理して次のプロンプトを投稿する。
export async function checkIssue(issueRef: IssueRef, apiBaseUrl: string): Promise<string> {
  const session = await prisma.issueSession.findUnique({ where: whereIssue(issueRef) });

  if (!session || !session.pendingStep || session.pendingPromptCommentId == null) {
    if (session?.planId) {
      const plan = await fetchJson<PlanResponse>(`${apiBaseUrl}/api/plans/${session.planId}`);
      return `このissueに保留中のプロンプトはありません(企画のステータス: ${plan.status})。`;
    }
    return (
      "このissueに保留中のプロンプトはありません。" +
      "npm run console -- plan または -- research から開始してください。"
    );
  }

  const comments = await listIssueComments(issueRef.owner, issueRef.repo, issueRef.number);
  const replies = comments.filter((c) => BigInt(c.id) > session.pendingPromptCommentId!);
  if (replies.length === 0) {
    return "まだ返信が見つかりません。Claude.aiのコンソールで実行した回答をissueに貼り付けてから再実行してください。";
  }
  const reply = replies[replies.length - 1].body;

  switch (session.pendingStep) {
    case "research":
      return handleResearchReply(issueRef, session, reply, apiBaseUrl);
    case "plan":
      return handlePlanReply(issueRef, session, reply, apiBaseUrl);
    case "draft":
      return handleDraftReply(issueRef, session, reply, apiBaseUrl);
    case "review":
      return handleReviewReply(issueRef, session, reply, apiBaseUrl);
    default:
      throw new Error(`未知の pendingStep です(内部エラー): ${session.pendingStep}`);
  }
}

async function handleResearchReply(
  issueRef: IssueRef,
  session: IssueSession,
  reply: string,
  apiBaseUrl: string
): Promise<string> {
  if (!session.topicId) throw new Error("topicId が見つかりません(内部エラー)");

  const parsed = researchReplySchema.parse(extractJsonBlock(reply));

  for (const item of parsed.items) {
    await postJson(`${apiBaseUrl}/api/topics/${session.topicId}/items`, {
      ...item,
      collectedBy: "console-user",
    });
  }

  await prisma.issueSession.update({
    where: { id: session.id },
    data: { pendingStep: null, pendingPromptCommentId: null },
  });

  await postIssueComment(
    issueRef.owner,
    issueRef.repo,
    issueRef.number,
    `✅ 調査結果を${parsed.items.length}件登録しました。企画立案に進む場合は\n` +
      `\`npm run console -- plan --issue ${issueRefLabel(issueRef)}\` を実行してください。`
  );

  return `調査結果を${parsed.items.length}件登録しました。`;
}

async function handlePlanReply(
  issueRef: IssueRef,
  session: IssueSession,
  reply: string,
  apiBaseUrl: string
): Promise<string> {
  const issue = await fetchGithubIssue(issueRef.owner, issueRef.repo, issueRef.number);
  const theme = `${issue.title}\n\n${issue.body}`;

  const planInput = createPlanSchema.parse({ theme, ...(extractJsonBlock(reply) as object) });
  const plan = await postJson<PlanResponse>(`${apiBaseUrl}/api/plans`, planInput);
  await patchJson(`${apiBaseUrl}/api/plans/${plan.id}`, { status: "drafting" });

  const prompt = buildWriterDraftConsolePrompt(plan);
  const comment = await postIssueComment(issueRef.owner, issueRef.repo, issueRef.number, prompt);

  await prisma.issueSession.update({
    where: { id: session.id },
    data: { planId: plan.id, pendingStep: "draft", pendingPromptCommentId: BigInt(comment.id) },
  });

  return `企画を登録しました(planId=${plan.id})。ライターへの執筆プロンプトをissueに投稿しました。`;
}

async function handleDraftReply(
  issueRef: IssueRef,
  session: IssueSession,
  reply: string,
  apiBaseUrl: string
): Promise<string> {
  if (!session.planId) throw new Error("planId が見つかりません(内部エラー)");

  const draftInput = createDraftSchema.parse(extractJsonBlock(reply));
  const draft = await postJson<DraftResponse>(
    `${apiBaseUrl}/api/plans/${session.planId}/drafts`,
    draftInput
  );
  await patchJson(`${apiBaseUrl}/api/plans/${session.planId}`, { status: "in_review" });

  const plan = await fetchJson<PlanResponse>(`${apiBaseUrl}/api/plans/${session.planId}`);
  const isFinalAttempt = draft.revisionNumber >= MAX_REVISIONS;
  const prompt = buildEditorReviewConsolePrompt(plan, draft, isFinalAttempt);
  const comment = await postIssueComment(issueRef.owner, issueRef.repo, issueRef.number, prompt);

  await prisma.issueSession.update({
    where: { id: session.id },
    data: { pendingStep: "review", pendingPromptCommentId: BigInt(comment.id) },
  });

  return `原稿(revision ${draft.revisionNumber})を登録しました。編集者へのレビュープロンプトをissueに投稿しました。`;
}

async function handleReviewReply(
  issueRef: IssueRef,
  session: IssueSession,
  reply: string,
  apiBaseUrl: string
): Promise<string> {
  if (!session.planId) throw new Error("planId が見つかりません(内部エラー)");

  const draft = await findLatestDraft(apiBaseUrl, session.planId);
  const reviewInput = createReviewSchema.parse(extractJsonBlock(reply));
  const isFinalAttempt = draft.revisionNumber >= MAX_REVISIONS;

  const review = await postJson<{ score: number; passed: boolean }>(
    `${apiBaseUrl}/api/plans/${session.planId}/drafts/${draft.id}/review`,
    { score: reviewInput.score, feedback: reviewInput.feedback, isFinalAttempt }
  );

  if (review.score >= 80) {
    return finish(issueRef, session, apiBaseUrl, "accepted", review.score);
  }
  if (isFinalAttempt) {
    const status = review.score > 70 ? "accepted_with_reservation" : "needs_human_review";
    return finish(issueRef, session, apiBaseUrl, status, review.score);
  }

  await patchJson(`${apiBaseUrl}/api/plans/${session.planId}`, { status: "needs_revision" });
  const plan = await fetchJson<PlanResponse>(`${apiBaseUrl}/api/plans/${session.planId}`);
  const updatedDraft = await fetchJson<DraftResponse>(
    `${apiBaseUrl}/api/plans/${session.planId}/drafts/${draft.id}`
  );
  const prompt = buildWriterRevisionConsolePrompt(plan, updatedDraft, isFinalAttempt);
  const comment = await postIssueComment(issueRef.owner, issueRef.repo, issueRef.number, prompt);

  await prisma.issueSession.update({
    where: { id: session.id },
    data: { pendingStep: "draft", pendingPromptCommentId: BigInt(comment.id) },
  });

  return `レビュー結果(${review.score}点)を登録しました。ライターへの修正プロンプトをissueに投稿しました。`;
}

async function finish(
  issueRef: IssueRef,
  session: IssueSession,
  apiBaseUrl: string,
  status: string,
  score: number
): Promise<string> {
  if (!session.planId) throw new Error("planId が見つかりません(内部エラー)");

  await patchJson(`${apiBaseUrl}/api/plans/${session.planId}`, { status });
  const plan = await fetchJson<PlanResponse>(`${apiBaseUrl}/api/plans/${session.planId}`);
  const draft = await findLatestDraft(apiBaseUrl, session.planId);

  await postIssueComment(
    issueRef.owner,
    issueRef.repo,
    issueRef.number,
    formatArticleComment(plan, draft, { finalScore: score, finalStatus: status })
  );

  await prisma.issueSession.update({
    where: { id: session.id },
    data: { pendingStep: null, pendingPromptCommentId: null },
  });

  return `パイプラインが完了しました(ステータス: ${status}, スコア: ${score}点)。記事をissueに投稿しました。`;
}
