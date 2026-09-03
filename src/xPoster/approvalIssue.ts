import { createIssue, type CreatedIssue } from "../lib/github";
import type { SelfCheckResult } from "./selfCheckPost";
import { PENDING_X_POST_APPROVAL_LABEL } from "./approval";

export interface ApprovalIssueContent {
  articleTitle: string;
  finalText: string;
  selfCheck: SelfCheckResult;
  // 承認issueを作成するリポジトリ。
  repoOwner: string;
  repoName: string;
  // 記事(Article)が生まれた元のsub-issue番号。IssueSessionが見つからない場合はnull
  // (コンソール駆動フロー以外の経路で記事が作られた場合など)。
  sourceIssueNumber: number | null;
}

// Issue本文を組み立てる。承認者が本文だけを見て判断できるよう、投稿候補・スコア・
// 指摘事項・改善点・承認方法・元記事issueへのリンクをひとまとめにする
// (amazon-sentaku-shiageのcreateApprovalIssue.tsを流用)。
export function buildIssueBody(content: ApprovalIssueContent): string {
  const { finalText, selfCheck } = content;
  const problems = selfCheck.problems.length > 0 ? selfCheck.problems.map((p) => `- ${p}`).join("\n") : "(なし)";
  const improvements =
    selfCheck.improvements.length > 0 ? selfCheck.improvements.map((i) => `- ${i}`).join("\n") : "(なし)";
  const sourceIssueLine =
    content.sourceIssueNumber != null
      ? `記事issue: ${content.repoOwner}/${content.repoName}#${content.sourceIssueNumber}`
      : null;

  return [
    `## 記事: ${content.articleTitle}`,
    ...(sourceIssueLine ? [sourceIssueLine] : []),
    "",
    "## 投稿候補",
    "```",
    finalText,
    "```",
    "",
    `## スコア: ${selfCheck.score} / 100 (${selfCheck.pass ? "合格" : "不合格 → 自動修正済み"})`,
    "",
    "## 指摘事項",
    problems,
    "",
    "## 改善点",
    improvements,
    "",
    "---",
    "この投稿を承認する場合はコメントで「承認」、却下する場合は「却下」と入力してください。",
    "却下する場合、「却下 もう少し落ち着いたトーンがいい」のように理由を続けて書くと記録されます。",
  ].join("\n");
}

export async function createXPostApprovalIssue(content: ApprovalIssueContent): Promise<CreatedIssue> {
  const title = `X投稿承認: ${content.articleTitle}`;
  const body = buildIssueBody(content);
  return createIssue(content.repoOwner, content.repoName, title, body, [PENDING_X_POST_APPROVAL_LABEL]);
}
