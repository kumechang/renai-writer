import type { IssueSession } from "@prisma/client";
import { prisma } from "../db/client";
import { getIssueState, getLastCommentUrl } from "../lib/github";

// 記事(Article)を書いたsub-issueを、IssueSessionから逆引きする。
export async function findOriginSession(articleId: string): Promise<IssueSession | null> {
  return prisma.issueSession.findFirst({ where: { articleId } });
}

// 記事issueがクローズ済み(=運用者が他媒体への公開を確認して手動でクローズしたもの)かどうか。
// 元issueが分からない、またはGitHub APIでの状態取得に失敗した場合は、内容を漏らさない
// 安全側(未公開)に倒す。
export async function isArticlePublished(originSession: IssueSession | null): Promise<boolean> {
  if (!originSession) return false;
  try {
    const state = await getIssueState(originSession.issueOwner, originSession.issueRepo, originSession.issueNumber);
    return state === "closed";
  } catch {
    return false;
  }
}

// クローズ済み記事issueの最後のコメントから、運用者が貼った記事の公開先URLを取得する。
// 見つからない、または取得に失敗した場合はnull。
export async function findPublishedArticleUrl(originSession: IssueSession | null): Promise<string | null> {
  if (!originSession) return null;
  try {
    return await getLastCommentUrl(originSession.issueOwner, originSession.issueRepo, originSession.issueNumber);
  } catch {
    return null;
  }
}
