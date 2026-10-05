import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db/client";
import {
  buildHealthReport,
  collectOutputCounts,
  countAlerts,
  evaluateChecks,
  fetchFailedRunCounts,
  loadOpsHealthConfig,
  type HealthCheckSpec,
} from "../src/ops/healthCheck";

const specs: HealthCheckSpec[] = [
  { id: "posts_generated", label: "X投稿の生成", minPerWindow: 3 },
  { id: "posts_pending_approval", label: "承認待ち", minPerWindow: 0, maxPerWindow: 3 },
  { id: "metrics_collected", label: "投稿指標の収集", minPerWindow: 1 },
  { id: "posting_time_weights_updated", label: "投稿時間帯の分析", minPerWindow: 0 },
  { id: "watched_posts_created", label: "返信候補の収集", minPerWindow: 0, paused: true, note: "停止中" },
];

describe("evaluateChecks", () => {
  it("alerts only on active checks below their minimum, and never on paused or informational ones", () => {
    const results = evaluateChecks(specs, { posts_generated: 2, metrics_collected: 5 });
    expect(results.map((r) => r.status)).toEqual(["alert", "ok", "ok", "info", "paused"]);
    expect(countAlerts(results, [])).toBe(1);
  });

  it("alerts when too many posts are stuck waiting for approval", () => {
    const results = evaluateChecks(specs, { posts_generated: 9, metrics_collected: 1, posts_pending_approval: 10 });
    expect(results.find((r) => r.spec.id === "posts_pending_approval")?.status).toBe("alert");
    expect(countAlerts(results, [])).toBe(1);
  });

  it("treats a missing count as zero", () => {
    const [first] = evaluateChecks(specs, {});
    expect(first.count).toBe(0);
    expect(first.status).toBe("alert");
  });

  it("counts failed workflow runs as alerts too", () => {
    const results = evaluateChecks(specs, { posts_generated: 9, metrics_collected: 1 });
    expect(countAlerts(results, [{ workflow: "X Post - Generate", failures: 2 }])).toBe(1);
    expect(countAlerts(results, null)).toBe(0);
  });
});

describe("buildHealthReport", () => {
  const now = new Date("2026-10-12T00:00:00Z");

  it("lists each check with its status and the failed workflows", () => {
    const results = evaluateChecks(specs, { posts_generated: 0, metrics_collected: 4 });
    const report = buildHealthReport({
      now,
      windowDays: 7,
      results,
      failedRuns: [{ workflow: "X Post - Generate", failures: 2 }],
    });
    expect(report).toContain("2026-10-12");
    expect(report).toContain("**要確認: 2件**");
    expect(report).toContain("| X投稿の生成 | 0 | 3件以上 | ⚠ 要確認 |");
    expect(report).toContain("| 返信候補の収集 | 0 | 停止中 | 停止中(想定どおり) |");
    expect(report).toContain("| 承認待ち | 0 | 3件以下 | OK |");
    expect(report).toContain("- X Post - Generate: 2件");
  });

  it("says so when nothing needs attention, and when run data could not be fetched", () => {
    const results = evaluateChecks(specs, { posts_generated: 9, metrics_collected: 1 });
    const report = buildHealthReport({ now, windowDays: 7, results, failedRuns: null });
    expect(report).toContain("要確認の項目はありません。");
    expect(report).toContain("取得できませんでした");
  });
});

describe("collectOutputCounts", () => {
  beforeEach(async () => {
    await prisma.xPostMetric.deleteMany();
    await prisma.xPost.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("counts only outputs created inside the window", async () => {
    const since = new Date("2026-10-05T00:00:00Z");
    const inside = new Date("2026-10-08T00:00:00Z");
    const outside = new Date("2026-09-01T00:00:00Z");
    const posted = await prisma.xPost.create({
      data: { generatedText: "a", finalText: "a", status: "posted", createdAt: inside },
    });
    await prisma.xPost.create({ data: { generatedText: "b", finalText: "b", status: "pending_approval", createdAt: inside } });
    await prisma.xPost.create({ data: { generatedText: "d", finalText: "d", status: "pending_approval", createdAt: outside } });
    await prisma.xPost.create({ data: { generatedText: "c", finalText: "c", status: "posted", createdAt: outside } });
    await prisma.xPostMetric.create({ data: { xPostId: posted.id, collectedAt: inside, impressions: 10 } });
    await prisma.xPostMetric.create({ data: { xPostId: posted.id, collectedAt: outside, impressions: 5 } });

    const counts = await collectOutputCounts(since);
    expect(counts.posts_generated).toBe(2);
    expect(counts.posts_pending_approval).toBe(2);
    expect(counts.posts_published).toBe(1);
    expect(counts.metrics_collected).toBe(1);
  });
});

describe("fetchFailedRunCounts", () => {
  it("returns null without a token, and groups failures by workflow otherwise", async () => {
    expect(await fetchFailedRunCounts("o", "r", new Date("2026-10-05"), undefined)).toBeNull();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ workflow_runs: [{ name: "A" }, { name: "B" }, { name: "A" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const counts = await fetchFailedRunCounts("o", "r", new Date("2026-10-05"), "tok");
      expect(counts).toEqual([
        { workflow: "A", failures: 2 },
        { workflow: "B", failures: 1 },
      ]);
      expect(fetchMock.mock.calls[0][0]).toContain("created=%3E%3D2026-10-05");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns null when the API call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    try {
      expect(await fetchFailedRunCounts("o", "r", new Date("2026-10-05"), "tok")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("ops-health config", () => {
  it("marks the intentionally stopped jobs as paused so they never raise alerts", () => {
    const config = loadOpsHealthConfig();
    const paused = config.checks.filter((c) => c.paused).map((c) => c.id);
    expect(paused).toEqual(expect.arrayContaining(["trend_words_captured", "watched_posts_created"]));
    expect(config.checks.some((c) => c.id === "posts_generated" && c.minPerWindow > 0)).toBe(true);
  });
});
