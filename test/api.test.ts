import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app";
import { prisma } from "../src/db/client";

const app = createApp();

describe("researcher data aggregation API", () => {
  let topicId: string;
  let itemId: string;

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a research topic (調査テーマ)", async () => {
    const res = await request(app)
      .post("/api/topics")
      .send({ title: "婚活サービス比較2026", theme: "20代向け婚活アプリ", brief: "料金と成婚率を重視" });

    expect(res.status).toBe(201);
    expect(res.body.title).toBe("婚活サービス比較2026");
    expect(res.body.status).toBe("collecting");
    topicId = res.body.id;
  });

  it("rejects a topic without a title", async () => {
    const res = await request(app).post("/api/topics").send({});
    expect(res.status).toBe(400);
  });

  it("lets the researcher submit a collected item", async () => {
    const res = await request(app)
      .post(`/api/topics/${topicId}/items`)
      .send({
        url: "https://example.com/konkatsu-report",
        sourceTitle: "婚活アプリ利用実態調査2026",
        siteName: "Example News",
        summary: "20代の婚活アプリ利用率は前年比15%増。料金の安さが選択理由の1位。",
        keyPoints: ["利用率15%増", "料金の安さが決め手"],
        quotes: [{ text: "手軽さが一番の魅力でした", context: "利用者インタビュー" }],
        reliability: 4,
        relevance: 5,
        tags: ["婚活アプリ", "市場調査"],
        collectedBy: "researcher-1",
      });

    expect(res.status).toBe(201);
    expect(res.body.source.domain).toBe("example.com");
    expect(res.body.keyPoints).toHaveLength(2);
    expect(res.body.tags).toEqual(["婚活アプリ", "市場調査"]);
    itemId = res.body.id;
  });

  it("rejects an item with an invalid url", async () => {
    const res = await request(app)
      .post(`/api/topics/${topicId}/items`)
      .send({ url: "not-a-url", summary: "x" });
    expect(res.status).toBe(400);
  });

  it("lists items for the topic sorted by relevance/reliability", async () => {
    const res = await request(app).get(`/api/topics/${topicId}/items`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(itemId);
  });

  it("filters items by tag", async () => {
    const res = await request(app).get(`/api/topics/${topicId}/items?tag=市場調査`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    const empty = await request(app).get(`/api/topics/${topicId}/items?tag=存在しないタグ`);
    expect(empty.body).toHaveLength(0);
  });

  it("lets the writer/editor update item status", async () => {
    const res = await request(app)
      .patch(`/api/topics/${topicId}/items/${itemId}`)
      .send({ status: "used" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("used");
  });

  it("builds a writer-ready briefing as JSON", async () => {
    const res = await request(app).get(`/api/topics/${topicId}/briefing`);
    expect(res.status).toBe(200);
    expect(res.body.topic.id).toBe(topicId);
    expect(res.body.itemCount).toBe(1);
    expect(res.body.items[0].summary).toContain("婚活アプリ");
  });

  it("builds a writer-ready briefing as Markdown", async () => {
    const res = await request(app).get(`/api/topics/${topicId}/briefing?format=markdown`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("# 婚活サービス比較2026");
    expect(res.text).toContain("引用");
  });

  it("excludes rejected items from the briefing", async () => {
    await request(app)
      .patch(`/api/topics/${topicId}/items/${itemId}`)
      .send({ status: "rejected" });

    const res = await request(app).get(`/api/topics/${topicId}/briefing`);
    expect(res.body.itemCount).toBe(0);
  });

  it("deletes an item", async () => {
    const del = await request(app).delete(`/api/topics/${topicId}/items/${itemId}`);
    expect(del.status).toBe(204);

    const list = await request(app).get(`/api/topics/${topicId}/items`);
    expect(list.body).toHaveLength(0);
  });

  it("returns 404 for an unknown topic", async () => {
    const res = await request(app).get("/api/topics/does-not-exist");
    expect(res.status).toBe(404);
  });
});
