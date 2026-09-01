// 編集者/ライター/調査員エージェントの実行に共通する設定。
export interface AgentRunConfig {
  apiBaseUrl: string;
  // 調査員に依頼した際、ResearchItem.collectedBy に記録される識別名としても使う
  collectedBy: string;
}

export interface PlanResponse {
  id: string;
  theme: string;
  targetReader: string;
  structure: string;
  volume: string;
  paidSection: string;
  titleCandidates: string[];
  recommendedTitle: string;
  selectedTitle: string | null;
  status: string;
}

export interface DraftResponse {
  id: string;
  planId: string;
  revisionNumber: number;
  title: string;
  content: string;
  wordCount: number;
  review: {
    score: number;
    passed: boolean;
    isFinalAttempt: boolean;
    feedback: string;
  } | null;
}
