import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db/client";
import {
  buildHealthReport,
  collectOutputCounts,
  collectShowcasePosts,
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

describe("showcase section", () => {
  const now = new Date("2026-10-12T00:00:00Z");
  const results = evaluateChecks(specs, { posts_generated: 9, metrics_collected: 1 });

  it("lists the latest published posts with their kinds and the 5-second-test reminder", () => {
    const report = buildHealthReport({
      now,
      windowDays: 7,
      results,
      failedRuns: [],
      showcase: [
        { postKind: "save_worthy", createdAt: new Date("2026-10-11"), text: "保存型の一文目です。\n続きです" },
        { postKind: "standalone", createdAt: new Date("2026-10-10"), text: "単発の投稿です" },
        { postKind: "save_worthy", createdAt: new Date("2026-10-09"), text: "もう一つの保存型" },
      ],
    });
    expect(report).toContain("## 直近の公開投稿");
    expect(report).toContain("種別: 保存型 2、単発 1(直近3件)");
    expect(report).toContain("| 2026-10-11 | 保存型 | 保存型の一文目です。 続きです |");
    expect(report).toContain("5秒テスト");
  });

  it("says so when nothing has been published", () => {
    expect(buildHealthReport({ now, windowDays: 7, results, failedRuns: [], showcase: [] })).toContain(
      "公開された投稿がありません。"
    );
  });

  it("omits the section when no showcase data is given", () => {
    expect(buildHealthReport({ now, windowDays: 7, results, failedRuns: [] })).not.toContain("直近の公開投稿");
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

describe("collectShowcasePosts", () => {
  afterAll(async () => {
    await prisma.xPost.deleteMany();
  });

  it("returns only published posts, newest first, up to the limit", async () => {
    await prisma.xPostMetric.deleteMany();
    await prisma.xPost.deleteMany();
    for (let i = 0; i < 4; i++) {
      await prisma.xPost.create({
        data: { generatedText: `p${i}`, finalText: `p${i}`, status: "posted", postKind: "standalone", createdAt: new Date(2026, 9, i + 1) },
      });
    }
    await prisma.xPost.create({ data: { generatedText: "x", finalText: "未承認", status: "pending_approval", createdAt: new Date(2026, 9, 20) } });
    const posts = await collectShowcasePosts(3);
    expect(posts.map((p) => p.text)).toEqual(["p3", "p2", "p1"]);
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
