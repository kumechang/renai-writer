import { prisma } from "../db/client";

const DEFAULT_WEIGHT = 1.0;

// 指定時間帯の重み。まだ分析されていない時間帯はデフォルト値(均等)を返す
// (amazon-sentaku-shiageのpostingTimeWeightsRepo.tsを流用)。
export async function getWeight(hour: number): Promise<number> {
  const row = await prisma.postingTimeWeight.findUnique({ where: { hour } });
  return row?.weight ?? DEFAULT_WEIGHT;
}

// 全24時間の平均重み。1件も分析されていなければデフォルト値。
export async function getAverageWeight(): Promise<number> {
  const result = await prisma.postingTimeWeight.aggregate({ _avg: { weight: true } });
  return result._avg.weight ?? DEFAULT_WEIGHT;
}

export interface PostingTimeWeightEntry {
  hour: number; // 0-23 (JST)
  weight: number;
  reason: string;
}

// analyzePostingTimesの分析結果をまとめて反映する。
export async function upsertWeights(entries: PostingTimeWeightEntry[]): Promise<void> {
  await prisma.$transaction(
    entries.map((entry) =>
      prisma.postingTimeWeight.upsert({
        where: { hour: entry.hour },
        create: { hour: entry.hour, weight: entry.weight, reason: entry.reason },
        update: { weight: entry.weight, reason: entry.reason },
      })
    )
  );
}
