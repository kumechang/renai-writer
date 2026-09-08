import { prisma } from "../db/client";
import type { XEngagementConfig } from "./config";
import { getJstDateString } from "../xPoster/time";

// 実際に今回、リプライを生成すべきかどうかを判定する。1日の上限(maxRepliesPerDay)に
// 達していないこと、直近のリプライ生成からminSpacingMinutes以上経っていることの
// 両方を満たす場合のみtrueを返す(「毎日3〜5回」というアドバイスに沿ったペース制御。
// src/xPoster/shouldGenerateNow.tsと同じ考え方だが、こちらは確率ではなく単純な
// 上限・間隔チェックにしている。ウォッチ対象の新着投稿自体が既に不確実な発生源であり、
// 生成確率をさらに絞る必要はないため)。
export async function shouldReplyNow(config: XEngagementConfig, now: Date): Promise<boolean> {
  const jstDate = getJstDateString(now);
  const createdToday = await countRepliesCreatedOnJstDate(jstDate);
  if (createdToday >= config.maxRepliesPerDay) return false;

  const lastReply = await prisma.engagementReply.findFirst({ orderBy: { createdAt: "desc" } });
  if (lastReply) {
    const minutesSinceLast = (now.getTime() - lastReply.createdAt.getTime()) / (1000 * 60);
    if (minutesSinceLast < config.minSpacingMinutes) return false;
  }

  return true;
}

// 指定したJSTカレンダー日に生成されたリプライ数(承認/却下/投稿結果を問わない)。
async function countRepliesCreatedOnJstDate(jstDateString: string): Promise<number> {
  const target = new Date(`${jstDateString}T00:00:00+09:00`);
  const from = new Date(target.getTime() - 1.5 * 24 * 60 * 60 * 1000);
  const to = new Date(target.getTime() + 1.5 * 24 * 60 * 60 * 1000);

  const rows = await prisma.engagementReply.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { createdAt: true },
  });
  return rows.filter((row) => getJstDateString(row.createdAt) === jstDateString).length;
}
