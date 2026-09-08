import { prisma } from "../db/client";
import { getJstHour } from "../xPoster/time";
import type { XEngagementConfig } from "./config";

// 過去の投稿時刻(JST時, 0-23)から、そのアカウントが実際に投稿している時間帯の集合を作る。
// 「だいたいこの時間に投稿する」がわかれば十分なため、投稿があった時間そのものだけを
// active扱いにする(前後の時間はisNearActiveHour側のwindowで吸収する)。
export function computeActiveHours(postedAtHours: number[]): Set<number> {
  return new Set(postedAtHours);
}

// 現在の時間(JST時)が、activeHoursのいずれかからwindow時間以内かどうか。
// 0時またぎ(23時台と0時台など)も正しく扱うため、24時間の円環距離で判定する。
export function isNearActiveHour(currentHour: number, activeHours: Set<number>, window: number): boolean {
  for (const hour of activeHours) {
    const diff = Math.abs(currentHour - hour);
    const circularDiff = Math.min(diff, 24 - diff);
    if (circularDiff <= window) return true;
  }
  return false;
}

// このアカウントを今回のfetchNewPostsで実際にチェックするべきかどうか。
// 過去の投稿履歴がconfig.minPostHistoryForTimeFiltering件未満の場合は時間帯を
// 判断できないため、毎回チェックする(新規登録アカウントのブートストラップ期間)。
// 十分な履歴があれば、現在時刻がそのアカウントの投稿時間帯から離れている場合のみ
// チェックをスキップし、X APIの呼び出し数を抑える。
export async function shouldCheckAccountNow(
  accountId: string,
  now: Date,
  config: Pick<XEngagementConfig, "minPostHistoryForTimeFiltering" | "activeHourWindow">
): Promise<boolean> {
  const posts = await prisma.watchedPost.findMany({
    where: { watchedAccountId: accountId },
    select: { postedAt: true },
  });

  if (posts.length < config.minPostHistoryForTimeFiltering) return true;

  const activeHours = computeActiveHours(posts.map((p) => getJstHour(p.postedAt)));
  return isNearActiveHour(getJstHour(now), activeHours, config.activeHourWindow);
}
