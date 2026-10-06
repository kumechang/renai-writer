import { describe, expect, it } from "vitest";
import {
  buildAnalyticsReport,
  classifyTheme,
  loadThemeConfig,
  median,
  parseAnalyticsCsv,
  parseCsv,
} from "../src/analytics/xAnalyticsReport";

const HEADER =
  "ポストID,日付,ポスト本文,ポストのリンク,インプレッション数,いいね,エンゲージメント,ブックマーク,共有された回数,新しいフォロー,返信,リポスト,プロフィールへのアクセス数,詳細のクリック数,URLのクリック数,ハッシュタグのクリック数,パーマリンクのクリック数";

function line(id: string, date: string, text: string, imp: number, like: number, bm: number, follow: number, prof: number, url = 0): string {
  const quoted = `"${text.replace(/"/g, '""')}"`;
  return `${id},"${date}",${quoted},https://x.com/a/status/${id},${imp},${like},${like},${bm},0,${follow},0,0,${prof},0,${url},0,0`;
}

const csv = [
  HEADER,
  line("1", "Mon, Oct 5, 2026", "@a 「別れた後」って、夜に連絡したくなる瞬間がある。", 2000, 10, 2, 1, 8),
  line("2", "Tue, Oct 6, 2026", "@b 「結婚するなら安心感」って、毎日の空気が変わるんだよね。", 400000, 900, 80, 2, 600),
  line("3", "Wed, Oct 7, 2026", "@c いい話だと思う。\nありがとう、\"素敵\"です", 50, 0, 0, 0, 0),
  line("4", "Wed, Oct 7, 2026", "元恋人への執着が残っているときの、よくある場面。", 30, 1, 0, 0, 1, 3),
].join("\n");

describe("parseCsv", () => {
  it("handles quoted commas, newlines and doubled quotes", () => {
    const rows = parseCsv('a,"b,c","d\ne"\n1,"x ""y""",3\n');
    expect(rows).toEqual([
      ["a", "b,c", "d\ne"],
      ["1", 'x "y"', "3"],
    ]);
  });
});

describe("classifyTheme", () => {
  const themes = loadThemeConfig();

  it("picks the theme with the most keyword hits and falls back to the other label", () => {
    expect(classifyTheme("元彼を忘れられない、未練が残る", themes)).toBe("失恋・未練");
    expect(classifyTheme("結婚するなら安心感のある人", themes)).toBe("いい関係・相手の条件");
    expect(classifyTheme("天気がいいですね", themes)).toBe(themes.otherLabel);
  });
});

describe("median", () => {
  it("handles odd, even and empty inputs", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});

describe("parseAnalyticsCsv / buildAnalyticsReport", () => {
  const themes = loadThemeConfig();
  const rows = parseAnalyticsCsv(csv, themes);

  it("splits replies from other posts and reads the numeric columns", () => {
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.isReply)).toHaveLength(3);
    expect(rows[1].impressions).toBe(400000);
    expect(rows[2].text).toContain("\n");
    expect(rows[0].theme).toBe("失恋・未練");
    expect(rows[1].theme).toBe("いい関係・相手の条件");
  });

  it("reports the share of replies, the concentration in the top reply, the hit rate and the themes", () => {
    const report = buildAnalyticsReport(rows, themes);
    expect(report).toContain("2026-10-05〜2026-10-07");
    expect(report).toContain("返信が表示数全体に占める割合: 100.0%");
    expect(report).toContain("上位1件の割合: 99%");
    expect(report).toContain("1,000表示以上の割合(当たり率): 67%(2/3件)");
    expect(report).toContain("| 失恋・未練 | 1 |");
    expect(report).toContain("| いい関係・相手の条件 | 1 |");
    expect(report).toContain("合計 3件(1投稿)");
    expect(report).toContain("投稿に紐づく数字");
  });

  it("flags small or lopsided theme samples and excludes the top reply from a second total", () => {
    const report = buildAnalyticsReport(rows, themes);
    expect(report).toContain("サンプル不足");
    expect(report).toContain("1件に集中");
    expect(report).toContain("上位1件を除く合計");
  });

  it("reads the parent account of each reply and groups repeat parents", () => {
    expect(rows[0].parent).toBe("@a");
    expect(rows[3].parent).toBe("");
    const repeatCsv = [
      HEADER,
      line("1", "Mon, Oct 5, 2026", "@x 一つ目の返信です。", 1500, 10, 2, 0, 5),
      line("2", "Tue, Oct 6, 2026", "@x 二つ目の返信です。", 500, 4, 0, 0, 1),
      line("3", "Wed, Oct 7, 2026", "@y 別の宛先への返信です。", 40, 0, 0, 0, 0),
    ].join("\n");
    const report = buildAnalyticsReport(parseAnalyticsCsv(repeatCsv, themes), themes);
    expect(report).toContain("宛先は2アカウント。2回以上返信したのは1アカウント(返信2件)");
    expect(report).toContain("| @x | 2 | 1000 | 1,500 | 2,000 | 6 |");
  });

  it("proposes the best-reacting replies as candidates to turn into own posts", () => {
    const promoCsv = [
      HEADER,
      line("1", "Mon, Oct 5, 2026", "@x 「保存したくなる」基準の話だよ。", 600, 10, 4, 0, 1),
      line("2", "Tue, Oct 6, 2026", "@y 反応の薄い返信です。", 5000, 2, 0, 0, 1),
      line("3", "Wed, Oct 7, 2026", "@z 表示が少なすぎる返信です。", 100, 9, 9, 0, 1),
    ].join("\n");
    const report = buildAnalyticsReport(parseAnalyticsCsv(promoCsv, themes), themes);
    const section = report.split("## 自分の投稿に昇格させる候補")[1].split("## 表示数の多い返信")[0];
    expect(section).toContain("| @x | 600 |");
    expect(section).not.toContain("@y");
    expect(section).not.toContain("@z");
  });

  it("counts reposts in the overall table", () => {
    const withRepost = HEADER + "\n" + `9,"Mon, Oct 5, 2026","@a 返信",https://x.com/a/status/9,100,1,1,0,0,0,0,7,0,0,0,0,0`;
    const report = buildAnalyticsReport(parseAnalyticsCsv(withRepost, themes), themes);
    expect(report).toContain("| 返信(@で始まる) | 1 | 100 | 100 | 100 | 1 | 0 | 7 |");
  });

  it("explains a missing column instead of failing silently", () => {
    expect(() => parseAnalyticsCsv("a,b\n1,2", themes)).toThrow("列がありません");
  });

  it("returns a short message for an empty file", () => {
    expect(buildAnalyticsReport([], themes)).toContain("データがありません");
  });
});
