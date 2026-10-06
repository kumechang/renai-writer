import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/db/client";
import {
  collectFollowerTrend,
  computeFollowerTrend,
  recordAccountSnapshot,
  saveAccountSnapshot,
} from "../src/xPoster/accountSnapshot";
import { buildFollowerSection, buildHealthReport, collectOutputCounts, evaluateChecks } from "../src/ops/healthCheck";
import { getXClient } from "../src/xPoster/xClient";
import { hasXCredentials } from "../src/xPoster/env";

vi.mock("../src/xPoster/xClient", () => ({ getXClient: vi.fn() }));
vi.mock("../src/xPoster/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/xPoster/env")>()),
  hasXCredentials: vi.fn(),
}));

beforeEach(async () => {
  await prisma.accountSnapshot.deleteMany();
  vi.mocked(getXClient).mockReset();
  vi.mocked(hasXCredentials).mockReset();
});

afterAll(async () => {
  await prisma.accountSnapshot.deleteMany();
  await prisma.$disconnect();
});

describe("saveAccountSnapshot", () => {
  it("keeps one row per day and overwrites a re-taken value", async () => {
    await saveAccountSnapshot({ capturedOn: "2026-10-07", followers: 38, source: "api" });
    await saveAccountSnapshot({ capturedOn: "2026-10-07", followers: 40, following: 27, source: "api" });
    const rows = await prisma.accountSnapshot.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].followers).toBe(40);
    expect(rows[0].following).toBe(27);
  });

  it("stores a manually entered past value with its source", async () => {
    await saveAccountSnapshot({ capturedOn: "2026-09-28", followers: 25, source: "manual" });
    const row = await prisma.accountSnapshot.findUnique({ where: { capturedOn: "2026-09-28" } });
    expect(row?.source).toBe("manual");
  });
});

describe("recordAccountSnapshot", () => {
  it("reads the follower counts from the API and stores them under today's JST date", async () => {
    vi.mocked(hasXCredentials).mockReturnValue(true);
    const me = vi.fn().mockResolvedValue({
      data: { public_metrics: { followers_count: 41, following_count: 27, tweet_count: 380 } },
    });
    vi.mocked(getXClient).mockReturnValue({ v2: { me } } as never);

    // UTC 2026-10-06 16:00 は、JSTでは 10-07 01:00
    const snapshot = await recordAccountSnapshot(new Date("2026-10-06T16:00:00Z"));

    expect(me).toHaveBeenCalledWith({ "user.fields": ["public_metrics"] });
    expect(snapshot?.capturedOn).toBe("2026-10-07");
    expect(snapshot?.followers).toBe(41);
    expect(snapshot?.tweetCount).toBe(380);
  });

  it("does nothing without X credentials", async () => {
    vi.mocked(hasXCredentials).mockReturnValue(false);
    expect(await recordAccountSnapshot()).toBeNull();
    expect(getXClient).not.toHaveBeenCalled();
  });

  it("fails loudly when the response has no follower count", async () => {
    vi.mocked(hasXCredentials).mockReturnValue(true);
    vi.mocked(getXClient).mockReturnValue({ v2: { me: vi.fn().mockResolvedValue({ data: {} }) } } as never);
    await expect(recordAccountSnapshot()).rejects.toThrow("followers_count");
  });
});

describe("computeFollowerTrend", () => {
  it("computes the change from the previous recorded day, in date order", () => {
    const trend = computeFollowerTrend([
      { capturedOn: "2026-09-29", followers: 52, source: "api" },
      { capturedOn: "2026-09-27", followers: 30, source: "manual" },
      { capturedOn: "2026-09-28", followers: 38, source: "api" },
    ]);
    expect(trend.map((r) => [r.date, r.delta])).toEqual([
      ["2026-09-27", null],
      ["2026-09-28", 8],
      ["2026-09-29", 14],
    ]);
  });
});

describe("collectFollowerTrend", () => {
  it("returns the latest rows within the window", async () => {
    for (const [d, f] of [
      ["2026-10-01", 30],
      ["2026-10-05", 35],
      ["2026-10-06", 38],
    ] as const) {
      await saveAccountSnapshot({ capturedOn: d, followers: f, source: "api" });
    }
    const trend = await collectFollowerTrend(2, new Date("2026-10-07T00:00:00Z"));
    expect(trend.map((r) => r.date)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(trend[1].delta).toBe(3);
  });
});

describe("follower section of the health report", () => {
  it("shows the total change, each day's delta and the source", () => {
    const lines = buildFollowerSection(
      computeFollowerTrend([
        { capturedOn: "2026-10-05", followers: 35, source: "manual" },
        { capturedOn: "2026-10-06", followers: 38, source: "api" },
      ])
    ).join("\n");
    expect(lines).toContain("増減: +3人(現在 38人)");
    expect(lines).toContain("| 2026-10-06 | 38 | +3 | API |");
    expect(lines).toContain("| 2026-10-05 | 35 | - | 手入力 |");
  });

  it("says so when nothing has been recorded", () => {
    expect(buildFollowerSection([]).join("\n")).toContain("まだ記録がありません");
  });

  it("is included in the report only when trend data is passed", () => {
    const results = evaluateChecks([{ id: "posts_generated", label: "生成", minPerWindow: 0 }], {});
    const base = { now: new Date("2026-10-12T00:00:00Z"), windowDays: 7, results, failedRuns: [] };
    expect(buildHealthReport(base)).not.toContain("フォロワー数の推移");
    expect(buildHealthReport({ ...base, followerTrend: [] })).toContain("フォロワー数の推移");
  });
});

describe("account_snapshots_recorded check", () => {
  it("counts snapshots recorded inside the window", async () => {
    await saveAccountSnapshot({ capturedOn: "2026-10-07", followers: 38, source: "api" });
    const counts = await collectOutputCounts(new Date(Date.now() - 24 * 60 * 60 * 1000));
    expect(counts.account_snapshots_recorded).toBe(1);
  });
});
