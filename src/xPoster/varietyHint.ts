import { prisma } from "../db/client";

const SUCCESSFUL_STATUSES = ["posted", "posted_dryrun"];

export type VarietyScope = { articleId: string } | { standalone: true } | { postKind: string };

// 同じ記事(または単発投稿)を何度も同じ切り口・同じ引用で書いてしまわないよう、
// 直近の投稿本文をプロンプトに渡して「違う切り口で書く」よう促すためのヒント
// (「記事を使い回すときは角度を変えてほしい」という運用要望に対応)。
export async function buildVarietyHint(scope: VarietyScope, window: number): Promise<string | null> {
  const where =
    "articleId" in scope
      ? { articleId: scope.articleId, status: { in: SUCCESSFUL_STATUSES } }
      : "postKind" in scope
        ? { postKind: scope.postKind, status: { in: SUCCESSFUL_STATUSES } }
        : { articleId: null, status: { in: SUCCESSFUL_STATUSES } };

  const posts = await prisma.xPost.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: window,
    select: { finalText: true },
  });
  if (posts.length === 0) return null;

  const lines = posts.map((post, i) => `${i + 1}. ${post.finalText}`);
  return [
    "過去に投稿した内容です。同じ切り口・同じ引用・似た書き出しを繰り返さず、違う角度で書いてください:",
    ...lines,
  ].join("\n");
}

const OPENING_LENGTH = 60;

// 投稿種別・記事をまたいで、アカウント全体の直近の投稿の書き出しを渡す。種別ごとの
// 重複チェックだけでは、「連絡先が消せない」のような同じネタや「〜ない?」のような同じ
// 書き出しが種別をまたいで繰り返され、タイムラインで「また同じ話」と読み飛ばされていたため。
export async function buildRecentOpeningsHint(window: number): Promise<string | null> {
  const posts = await prisma.xPost.findMany({
    where: { status: { in: SUCCESSFUL_STATUSES } },
    orderBy: { createdAt: "desc" },
    take: window,
    select: { finalText: true },
  });
  if (posts.length === 0) return null;

  const lines = posts.map((post) => {
    const flat = post.finalText.replace(/\s+/g, " ").trim();
    return `- ${flat.length > OPENING_LENGTH ? `${flat.slice(0, OPENING_LENGTH)}…` : flat}`;
  });
  const closings = posts.map((post) => `- ${extractClosing(post.finalText)}`);
  return [
    "アカウント全体の直近の投稿の書き出しです(新しい順)。同じネタ・同じ場面・似た書き出しを繰り返さないでください:",
    ...lines,
    "",
    "同じく、直近の投稿の締めの一文です(新しい順)。似た締め方・同じ語尾・同じ言い回しを繰り返さないでください:",
    ...closings,
  ].join("\n");
}

const CLOSING_LENGTH = 40;

// 投稿の最後の一文(句点・改行区切り)を取り出す。長い場合は後ろ側を残す(締めの言い回しが残るように)。
export function extractClosing(text: string): string {
  const sentences = text
    .split(/[。！？!?\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const last = (sentences[sentences.length - 1] ?? text).replace(/\s+/g, " ");
  return last.length > CLOSING_LENGTH ? `…${last.slice(-CLOSING_LENGTH)}` : last;
}
