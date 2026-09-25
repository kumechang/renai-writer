import { z } from "zod";

// 投稿は人の確認なしに自動投稿されうるため、読者を傷つけうる内容は点数の合計とは別に
// 1つでも該当したら不合格(=人の承認待ち)にする。点数に混ぜると、他の項目が高得点なら
// 安全面の問題があっても合格してしまうため。
export const safetyViolationsSchema = z.array(z.string()).default([]);

const SAFETY_CHECK_ITEMS = [
  "希死念慮・自傷・摂食障害・不眠などの症状、DV・モラハラ・性暴力、精神疾患に触れている",
  "つきまとい、相手のSNSや居場所の監視、拒否(ブロック・鍵垢化・連絡を断られた)後の接触を、肯定している、" +
    "または「あるある」として当たり前のことのように扱っている",
  "失恋直後で自分を責めている読者が読んで「自分はまだダメだ」と感じる判定やラベルがある" +
    "(「〜な時点でまだ終わっていない」「本当に手放せた人は〜しない」「未練がましい」「都合のいい」など)",
  "読者に回復の期限を示している(「3ヶ月で忘れられる」など)、または出典のない数値や、" +
    "実在を確認できない体験談・取材(「〜できた人たちは」「〜な人の多くが」など)を事実のように書いている",
  "心理学・脳科学の話を「〜と同じ」「脳の仕組みだから〜なだけ」と断定している" +
    "(「〜という研究もある」程度の強さを超えている)",
];

export function buildSafetyCheckSection(): string {
  return [
    "# 安全チェック(1つでも該当すれば、点数に関係なく不合格)",
    "",
    "以下に1つでも該当する場合は、該当した内容を`safety_violations`に1項目ずつ具体的に書いてください。",
    "該当しなければ`safety_violations`は空配列にしてください。",
    "該当する場合は、その表現を取り除いた修正版の本文を作成してください。",
    "",
    ...SAFETY_CHECK_ITEMS.map((item) => `- ${item}`),
  ].join("\n");
}

interface SafetyGateInput {
  pass: boolean;
  problems: string[];
  safety_violations: string[];
}

export function applySafetyGate<T extends SafetyGateInput>(data: T): T {
  const violations = data.safety_violations.map((v) => v.trim()).filter((v) => v.length > 0);
  if (violations.length === 0) return { ...data, safety_violations: [] };
  return {
    ...data,
    pass: false,
    safety_violations: violations,
    problems: [...violations.map((v) => `[安全] ${v}`), ...data.problems],
  };
}
