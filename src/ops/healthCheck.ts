import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "../db/client";
import type { FollowerTrendRow } from "../xPoster/accountSnapshot";

export type HealthCheckId =
  | "posts_generated"
  | "posts_published"
  | "posts_pending_approval"
  | "account_snapshots_recorded"
  | "metrics_collected"
  | "posting_time_weights_updated"
  | "trend_words_captured"
  | "watched_posts_created";

export interface HealthCheckSpec {
  id: HealthCheckId;
  label: string;
  // 期間内の出力件数がこの値を下回ったら「要確認」にする。0なら件数を表示するだけで、警告はしない。
  minPerWindow: number;
  // 件数がこの値を上回ったら「要確認」にする(承認待ちが溜まる、などを見る)。省略すると上限なし。
  maxPerWindow?: number;
  // 意図して止めている処理。警告は出さず、件数だけを表示する。
  paused?: boolean;
  note?: string;
}

export interface OpsHealthConfig {
  windowDays: number;
  checks: HealthCheckSpec[];
}

export type HealthStatus = "ok" | "alert" | "paused" | "info";

export interface HealthCheckResult {
  spec: HealthCheckSpec;
  count: number;
  status: HealthStatus;
}

export function loadOpsHealthConfig(): OpsHealthConfig {
  const file = path.resolve(__dirname, "../../config/ops-health.json");
  return JSON.parse(readFileSync(file, "utf-8")) as OpsHealthConfig;
}

// 純粋関数: 期間内の出力件数から、各処理の状態を決める。
// 自動化した処理が、誰にも気づかれないまま何も出力しなくなる(候補ゼロのまま動き続ける等)のを
// 防ぐための仕組みで、「動いたか」ではなく「出力が出たか」を見る。
export function evaluateChecks(specs: HealthCheckSpec[], counts: Partial<Record<HealthCheckId, number>>): HealthCheckResult[] {
  return specs.map((spec) => {
    const count = counts[spec.id] ?? 0;
    let status: HealthStatus;
    if (spec.paused) status = "paused";
    else if (spec.minPerWindow <= 0 && spec.maxPerWindow === undefined) status = "info";
    else if (count < spec.minPerWindow) status = "alert";
    else if (spec.maxPerWindow !== undefined && count > spec.maxPerWindow) status = "alert";
    else status = "ok";
    return { spec, count, status };
  });
}

export function countAlerts(results: HealthCheckResult[], failedRuns: FailedRunCount[] | null): number {
  return results.filter((r) => r.status === "alert").length + (failedRuns ?? []).length;
}

export async function collectOutputCounts(since: Date): Promise<Record<HealthCheckId, number>> {
  const [generated, published, pending, snapshots, metrics, weights, trends, watched] = await Promise.all([
    prisma.xPost.count({ where: { createdAt: { gte: since } } }),
    prisma.xPost.count({ where: { status: "posted", createdAt: { gte: since } } }),
    // 承認待ちは、期間に関係なく、溜まっている件数を見る。
    prisma.xPost.count({ where: { status: "pending_approval" } }),
    prisma.accountSnapshot.count({ where: { capturedAt: { gte: since } } }),
    prisma.xPostMetric.count({ where: { collectedAt: { gte: since } } }),
    prisma.postingTimeWeight.count({ where: { updatedAt: { gte: since } } }),
    prisma.trendWord.count({ where: { capturedAt: { gte: since } } }),
    prisma.watchedPost.count({ where: { createdAt: { gte: since } } }),
  ]);
  return {
    posts_generated: generated,
    posts_published: published,
    posts_pending_approval: pending,
    account_snapshots_recorded: snapshots,
    metrics_collected: metrics,
    posting_time_weights_updated: weights,
    trend_words_captured: trends,
    watched_posts_created: watched,
  };
}

export interface FailedRunCount {
  workflow: string;
  failures: number;
}

// 直近のGitHub Actionsの失敗を、ワークフロー別に数える。取得できなければnull(レポートには
// 「取得できなかった」と書く)。
export async function fetchFailedRunCounts(
  owner: string,
  repo: string,
  since: Date,
  token: string | undefined
): Promise<FailedRunCount[] | null> {
  if (!token) return null;
  const day = since.toISOString().slice(0, 10);
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/runs?status=failure&created=%3E%3D${day}&per_page=100`,
    { headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { workflow_runs?: { name?: string }[] };
  const counts = new Map<string, number>();
  for (const run of data.workflow_runs ?? []) {
    const name = run.name ?? "(不明)";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].map(([workflow, failures]) => ({ workflow, failures })).sort((a, b) => b.failures - a.failures);
}

const STATUS_LABEL: Record<HealthStatus, string> = {
  ok: "OK",
  alert: "⚠ 要確認",
  paused: "停止中(想定どおり)",
  info: "参考",
};

export interface ShowcasePost {
  postKind: string;
  createdAt: Date;
  text: string;
}

const KIND_LABEL: Record<string, string> = {
  promo: "記事紹介",
  standalone: "単発",
  url_thread: "記事URL付きスレッド",
  behind_the_scenes: "制作裏話",
  save_worthy: "保存型",
};

// プロフィールを見に来た人が、フォローを決めるときに見る「直近の公開投稿」。
export async function collectShowcasePosts(limit = 10): Promise<ShowcasePost[]> {
  const posts = await prisma.xPost.findMany({
    where: { status: "posted" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { postKind: true, createdAt: true, finalText: true },
  });
  return posts.map((p) => ({ postKind: p.postKind, createdAt: p.createdAt, text: p.finalText }));
}

export function buildShowcaseSection(posts: ShowcasePost[]): string[] {
  const lines: string[] = [];
  lines.push("## 直近の公開投稿(プロフィールを見に来た人が見るもの)");
  lines.push("");
  if (posts.length === 0) {
    lines.push("公開された投稿がありません。");
    return lines;
  }
  const counts = new Map<string, number>();
  for (const p of posts) counts.set(p.postKind, (counts.get(p.postKind) ?? 0) + 1);
  lines.push(
    `種別: ${[...counts.entries()].map(([k, n]) => `${KIND_LABEL[k] ?? k} ${n}`).join("、")}(直近${posts.length}件)`
  );
  lines.push("");
  lines.push("| 日付 | 種別 | 書き出し |");
  lines.push("| --- | --- | --- |");
  for (const p of posts) {
    const flat = p.text.replace(/\s+/g, " ").trim();
    lines.push(
      `| ${p.createdAt.toISOString().slice(0, 10)} | ${KIND_LABEL[p.postKind] ?? p.postKind} | ${(flat.length > 50 ? `${flat.slice(0, 50)}…` : flat).replace(/\|/g, "\\|")} |`
    );
  }
  lines.push("");
  lines.push(
    "確認: プロフィール文・固定投稿・この直近の投稿が、同じ約束を語っているか。Claudeにプロフィールとこの一覧を渡して、" +
      "「誰向けで、フォローすると何が得られるか」を5秒で答えられるか(5秒テスト)を試す。約束とずれた話題・雑談・宣伝は置かない。"
  );
  return lines;
}

export function buildFollowerSection(trend: FollowerTrendRow[]): string[] {
  const lines: string[] = [];
  lines.push("## フォロワー数の推移(日次の記録)");
  lines.push("");
  if (trend.length === 0) {
    lines.push("まだ記録がありません(毎日の指標収集で、フォロワー数が記録されます)。");
    return lines;
  }
  const fmt = (n: number | null): string => (n === null ? "-" : n > 0 ? `+${n}` : String(n));
  const total = trend.reduce((sum, r) => sum + (r.delta ?? 0), 0);
  lines.push(`直近${trend.length}件の記録で、${trend[0].date}から${trend[trend.length - 1].date}までの増減: ${fmt(total)}人(現在 ${trend[trend.length - 1].followers}人)`);
  lines.push("");
  lines.push("| 日付 | フォロワー | 前の記録との差 | 記録元 |");
  lines.push("| --- | --- | --- | --- |");
  for (const r of trend) {
    lines.push(`| ${r.date} | ${r.followers} | ${fmt(r.delta)} | ${r.source === "manual" ? "手入力" : "API"} |`);
  }
  lines.push("");
  lines.push("フォローの増減は、投稿別の「新しいフォロー」ではなく、この数字を見る(投稿別の数字は実際より大きく少なく出る)。");
  return lines;
}

export function buildHealthReport(input: {
  now: Date;
  windowDays: number;
  results: HealthCheckResult[];
  failedRuns: FailedRunCount[] | null;
  showcase?: ShowcasePost[];
  followerTrend?: FollowerTrendRow[];
}): string {
  const lines: string[] = [];
  const alerts = countAlerts(input.results, input.failedRuns);
  lines.push(`# 週次ヘルスチェック(直近${input.windowDays}日、${input.now.toISOString().slice(0, 10)}時点)`);
  lines.push("");
  lines.push(alerts === 0 ? "要確認の項目はありません。" : `**要確認: ${alerts}件**`);
  lines.push("");
  lines.push("## 処理の出力件数");
  lines.push("");
  lines.push("| 処理 | 件数 | 基準 | 状態 |");
  lines.push("| --- | --- | --- | --- |");
  for (const r of input.results) {
    const basisParts: string[] = [];
    if (r.spec.minPerWindow > 0) basisParts.push(`${r.spec.minPerWindow}件以上`);
    if (r.spec.maxPerWindow !== undefined) basisParts.push(`${r.spec.maxPerWindow}件以下`);
    const basis = r.spec.paused ? (r.spec.note ?? "停止中") : basisParts.length > 0 ? basisParts.join("、") : "-";
    lines.push(`| ${r.spec.label} | ${r.count} | ${basis} | ${STATUS_LABEL[r.status]} |`);
  }
  lines.push("");
  lines.push("## GitHub Actionsの失敗");
  lines.push("");
  if (input.failedRuns === null) {
    lines.push("取得できませんでした(トークン未設定、またはAPIエラー)。");
  } else if (input.failedRuns.length === 0) {
    lines.push("失敗はありません。");
  } else {
    for (const f of input.failedRuns) lines.push(`- ${f.workflow}: ${f.failures}件`);
  }
  lines.push("");
  if (input.followerTrend) {
    lines.push(...buildFollowerSection(input.followerTrend));
    lines.push("");
  }
  if (input.showcase) {
    lines.push(...buildShowcaseSection(input.showcase));
    lines.push("");
  }
  lines.push("## 見方");
  lines.push("");
  lines.push("- 件数が基準を下回る処理は、動いていても出力が出ていない可能性があります。ログと設定を確認してください。");
  lines.push("- 意図して止めている処理は「停止中」と表示します。再開したら、`config/ops-health.json`の`paused`を外してください。");
  return lines.join("\n");
}
