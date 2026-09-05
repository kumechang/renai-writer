import { prisma } from "../db/client";
import type { XPosterConfig } from "./config";
import { getWeight, getAverageWeight } from "./postingTimeWeights";
import { getJstHour, getJstDateString } from "./time";

export interface PostingProbabilityContext {
  remainingTarget: number;
  remainingActiveHours: number;
  hourWeight: number;
  averageWeight: number;
}

// 純粋関数: 今この瞬間に投稿候補を作るべき確率(0〜1)を計算する。
// - 目標を既に満たしていれば0
// - その日最後のアクティブ時間なら、未達分を取りこぼさないよう1(必ず生成)
// - それ以外は「残り目標 / 残り時間」を基準に、時間帯の重み(過去のエンゲージメント傾向)で補正する
// (amazon-sentaku-shiageのshouldGenerateNow.tsを流用)。
export function computePostingProbability(ctx: PostingProbabilityContext): number {
  if (ctx.remainingTarget <= 0) return 0;
  if (ctx.remainingActiveHours <= 1) return 1;

  const baseProbability = ctx.remainingTarget / ctx.remainingActiveHours;
  const weightRatio = ctx.averageWeight > 0 ? ctx.hourWeight / ctx.averageWeight : 1;
  return Math.min(1, Math.max(0, baseProbability * weightRatio));
}

// このアカウントの投稿可能時間帯のうち、今の時刻(含む)から終了時刻までに残っているアクティブ時間数。
export function countRemainingActiveHours(now: Date, config: XPosterConfig): number {
  const currentHour = getJstHour(now);
  const { endHour } = config.postingWindow;
  return Math.max(1, endHour - currentHour);
}

// 実際に今回、投稿候補を作るべきかどうかを判定する。
// minSpacingHours未満での連投を防いだ上で、computePostingProbabilityの確率で決める。
export async function shouldGenerateNow(config: XPosterConfig, now: Date): Promise<boolean> {
  const lastPost = await prisma.xPost.findFirst({ orderBy: { createdAt: "desc" } });
  if (lastPost) {
    const hoursSinceLast = (now.getTime() - lastPost.createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLast < config.minSpacingHours) return false;
  }

  const jstDate = getJstDateString(now);
  const createdToday = await countXPostsCreatedOnJstDate(jstDate);
  const remainingTarget = config.targetPostsPerDay - createdToday;
  const remainingActiveHours = countRemainingActiveHours(now, config);
  const hourWeight = await getWeight(getJstHour(now));
  const averageWeight = await getAverageWeight();

  const probability = computePostingProbability({
    remainingTarget,
    remainingActiveHours,
    hourWeight,
    averageWeight,
  });

  return Math.random() < probability;
}

// 指定したJSTカレンダー日に生成された投稿候補数(承認/却下/投稿結果を問わない)。
// createdAtはUTCで保存されるDateTimeだが、Prismaはクエリ結果を実際のDateオブジェクトとして
// 返すため、前後1.5日分を粗く取得したうえでJST日付の厳密な判定はJS側で行う。
async function countXPostsCreatedOnJstDate(jstDateString: string): Promise<number> {
  const target = new Date(`${jstDateString}T00:00:00+09:00`);
  const from = new Date(target.getTime() - 1.5 * 24 * 60 * 60 * 1000);
  const to = new Date(target.getTime() + 1.5 * 24 * 60 * 60 * 1000);

  const rows = await prisma.xPost.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { createdAt: true },
  });
  return rows.filter((row) => getJstDateString(row.createdAt) === jstDateString).length;
}
