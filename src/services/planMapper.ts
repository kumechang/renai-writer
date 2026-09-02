import type { Plan } from "@prisma/client";

export interface PlanDTO {
  id: string;
  theme: string;
  targetReader: string;
  structure: string;
  volume: string;
  paidSection: string;
  titleCandidates: string[];
  recommendedTitles: string[];
  status: string;
  createdAt: string;
  updatedAt: string;
}

function safeParseArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function toPlanDTO(plan: Plan): PlanDTO {
  return {
    id: plan.id,
    theme: plan.theme,
    targetReader: plan.targetReader,
    structure: plan.structure,
    volume: plan.volume,
    paidSection: plan.paidSection,
    titleCandidates: safeParseArray(plan.titleCandidates),
    recommendedTitles: safeParseArray(plan.recommendedTitles),
    status: plan.status,
    createdAt: plan.createdAt.toISOString(),
    updatedAt: plan.updatedAt.toISOString(),
  };
}
