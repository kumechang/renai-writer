import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";

const app = createApp();

function makeTitleCandidates(prefix: string, count = 50): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}タイトル案${i + 1}`);
}

describe("plan / draft / review API", () => {
  let planId: string;
  let draftId: string;

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("rejects a plan without exactly 50 title candidates", async () => {
    const res = await request(app)
      .post("/api/plans")
      .send({
        theme: "婚活アプリ特集",
        targetReader: "20代女性",
        structure: "## はじめに\n## 比較表\n## まとめ",
        volume: "3000字",
        paidSection: "比較表以降を有料化",
        titleCandidates: ["1件だけ"],
        recommendedTitle: "1件だけ",
      });
    expect(res.status).toBe(400);
  });

  it("rejects a plan whose recommendedTitle is not in titleCandidates", async () => {
    const candidates = makeTitleCandidates("A");
    const res = await request(app)
      .post("/api/plans")
      .send({
        theme: "婚活アプリ特集",
        targetReader: "20代女性",
        structure: "## はじめに\n## 比較表\n## まとめ",
        volume: "3000字",
        paidSection: "比較表以降を有料化",
        titleCandidates: candidates,
        recommendedTitle: "候補にないタイトル",
      });
    expect(res.status).toBe(400);
  });

  it("creates a plan (編集者による企画立案)", async () => {
    const candidates = makeTitleCandidates("B");
    const res = await request(app)
      .post("/api/plans")
      .send({
        theme: "婚活アプリ特集",
        targetReader: "20代女性で婚活を始めたばかりの人",
        structure: "## はじめに\n## 料金比較\n## 成婚率データ\n## まとめ",
        volume: "全体3000字(無料1500字/有料1500字)",
        paidSection: "成婚率データ以降を有料化",
        titleCandidates: candidates,
        recommendedTitle: candidates[0],
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("planning");
    expect(res.body.titleCandidates).toHaveLength(50);
    expect(res.body.selectedTitle).toBeNull();
    planId = res.body.id;
  });

  it("lets a human confirm selectedTitle from the candidates", async () => {
    const plan = await request(app).get(`/api/plans/${planId}`);
    const chosen = plan.body.titleCandidates[3];

    const res = await request(app)
      .patch(`/api/plans/${planId}`)
      .send({ selectedTitle: chosen, status: "drafting" });

    expect(res.status).toBe(200);
    expect(res.body.selectedTitle).toBe(chosen);
    expect(res.body.status).toBe("drafting");
  });

  it("rejects selectedTitle that is not among titleCandidates", async () => {
    const res = await request(app)
      .patch(`/api/plans/${planId}`)
      .send({ selectedTitle: "存在しないタイトル" });
    expect(res.status).toBe(400);
  });

  it("lets the writer submit an initial draft (revisionNumber=0)", async () => {
    const res = await request(app)
      .post(`/api/plans/${planId}/drafts`)
      .send({ title: "婚活アプリ比較記事", content: "## はじめに\n本文...\n<!-- PAID_SECTION -->\n有料部分" });

    expect(res.status).toBe(201);
    expect(res.body.revisionNumber).toBe(0);
    expect(res.body.wordCount).toBeGreaterThan(0);
    expect(res.body.review).toBeNull();
    draftId = res.body.id;
  });

  it("auto-increments revisionNumber for a second draft", async () => {
    const res = await request(app)
      .post(`/api/plans/${planId}/drafts`)
      .send({ title: "婚活アプリ比較記事(修正版)", content: "修正後の本文", wordCount: 100 });
    expect(res.status).toBe(201);
    expect(res.body.revisionNumber).toBe(1);
  });

  it("lets the editor review a draft and score it", async () => {
    const res = await request(app)
      .post(`/api/plans/${planId}/drafts/${draftId}/review`)
      .send({ score: 65, feedback: "料金比較の具体性が不足しています。", isFinalAttempt: false });

    expect(res.status).toBe(201);
    expect(res.body.passed).toBe(false);
    expect(res.body.score).toBe(65);
  });

  it("rejects a second review for the same draft", async () => {
    const res = await request(app)
      .post(`/api/plans/${planId}/drafts/${draftId}/review`)
      .send({ score: 90, feedback: "OK" });
    expect(res.status).toBe(409);
  });

  it("rejects an out-of-range score", async () => {
    const draftRes = await request(app)
      .post(`/api/plans/${planId}/drafts`)
      .send({ title: "検証用ドラフト", content: "検証用の本文" });

    const res = await request(app)
      .post(`/api/plans/${planId}/drafts/${draftRes.body.id}/review`)
      .send({ score: 150, feedback: "OK" });
    expect(res.status).toBe(400);
  });

  it("returns the draft with its review embedded", async () => {
    const res = await request(app).get(`/api/plans/${planId}/drafts/${draftId}`);
    expect(res.status).toBe(200);
    expect(res.body.review.score).toBe(65);
    expect(res.body.review.passed).toBe(false);
  });

  it("lists drafts ordered by revisionNumber", async () => {
    const res = await request(app).get(`/api/plans/${planId}/drafts`);
    expect(res.status).toBe(200);
    expect(res.body.map((d: { revisionNumber: number }) => d.revisionNumber)).toEqual([0, 1, 2]);
  });

  it("marks a high score as passed", async () => {
    const draftsRes = await request(app).get(`/api/plans/${planId}/drafts`);
    const secondDraftId = draftsRes.body[1].id;

    const res = await request(app)
      .post(`/api/plans/${planId}/drafts/${secondDraftId}/review`)
      .send({ score: 85, feedback: "十分に改善されました。", isFinalAttempt: true });

    expect(res.status).toBe(201);
    expect(res.body.passed).toBe(true);
  });
});
