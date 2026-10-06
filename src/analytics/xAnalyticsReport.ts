import { readFileSync } from "node:fs";
import path from "node:path";

// Xのアナリティクス(コンテンツ)からエクスポートしたCSVを集計し、返信と自分の投稿に分けて、
// 表示数の分布・当たり率・プロフィールアクセス率・テーマ別の結果をmarkdownにまとめる。
// 週1回、運用者がCSVを渡して見る想定(Claude APIは呼ばない)。

// 引用符で囲まれたフィールド内のカンマ・改行・""に対応した、最小限のCSVパーサー。
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface AnalyticsRow {
  id: string;
  date: Date;
  text: string;
  impressions: number;
  likes: number;
  bookmarks: number;
  follows: number;
  replies: number;
  reposts: number;
  profileVisits: number;
  urlClicks: number;
  isReply: boolean;
  // 返信の宛先(本文の先頭の@ユーザー名)。返信でなければ空。
  parent: string;
  theme: string;
}

const COLUMNS = {
  id: "ポストID",
  date: "日付",
  text: "ポスト本文",
  impressions: "インプレッション数",
  likes: "いいね",
  bookmarks: "ブックマーク",
  follows: "新しいフォロー",
  replies: "返信",
  reposts: "リポスト",
  profileVisits: "プロフィールへのアクセス数",
  urlClicks: "URLのクリック数",
} as const;

export interface ThemeConfig {
  themes: { id: string; label: string; keywords: string[] }[];
  otherLabel: string;
}

export function loadThemeConfig(): ThemeConfig {
  const file = path.resolve(__dirname, "../../config/x-reply-themes.json");
  return JSON.parse(readFileSync(file, "utf-8")) as ThemeConfig;
}

export function classifyTheme(text: string, config: ThemeConfig): string {
  let best = config.otherLabel;
  let bestHits = 0;
  for (const theme of config.themes) {
    const hits = theme.keywords.filter((k) => text.includes(k)).length;
    if (hits > bestHits) {
      best = theme.label;
      bestHits = hits;
    }
  }
  return best;
}

function toNumber(value: string | undefined): number {
  const n = Number((value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// 「Fri, Oct 2, 2026」形式の日付を読む。
function parseDate(value: string): Date {
  return new Date(`${value.replace(/^\w+,\s*/, "")} 00:00:00 UTC`);
}

export function parseAnalyticsCsv(text: string, themes: ThemeConfig): AnalyticsRow[] {
  const [header, ...body] = parseCsv(text);
  if (!header) return [];
  const index = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`CSVに「${name}」列がありません。アナリティクスの「コンテンツ」からエクスポートしたCSVを使ってください。`);
    return i;
  };
  const col = Object.fromEntries(Object.entries(COLUMNS).map(([k, v]) => [k, index(v)])) as Record<keyof typeof COLUMNS, number>;
  return body.map((r) => {
    const content = r[col.text] ?? "";
    const isReply = content.startsWith("@");
    return {
      id: r[col.id] ?? "",
      date: parseDate(r[col.date] ?? ""),
      text: content,
      impressions: toNumber(r[col.impressions]),
      likes: toNumber(r[col.likes]),
      bookmarks: toNumber(r[col.bookmarks]),
      follows: toNumber(r[col.follows]),
      replies: toNumber(r[col.replies]),
      reposts: toNumber(r[col.reposts]),
      profileVisits: toNumber(r[col.profileVisits]),
      urlClicks: toNumber(r[col.urlClicks]),
      isReply,
      parent: isReply ? (/^(@\w+)/.exec(content)?.[1] ?? "") : "",
      theme: isReply ? classifyTheme(content, themes) : "",
    };
  });
}

function sum(rows: AnalyticsRow[], pick: (r: AnalyticsRow) => number): number {
  return rows.reduce((total, r) => total + pick(r), 0);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const pct = (num: number, den: number, digits = 2): string => (den > 0 ? `${((num / den) * 100).toFixed(digits)}%` : "-");

const BUCKETS: { label: string; min: number; max: number }[] = [
  { label: "〜99", min: 0, max: 100 },
  { label: "100〜299", min: 100, max: 300 },
  { label: "300〜999", min: 300, max: 1000 },
  { label: "1,000〜4,999", min: 1000, max: 5000 },
  { label: "5,000〜19,999", min: 5000, max: 20000 },
  { label: "20,000〜", min: 20000, max: Infinity },
];

// その週の月曜日(UTC)。
function weekStart(date: Date): string {
  const day = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - day * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const MIN_SAMPLE = 20;

function themeNote(n: number, top: number, total: number): string {
  const notes: string[] = [];
  if (n < MIN_SAMPLE) notes.push("サンプル不足");
  if (total > 0 && top / total >= 0.5) notes.push("1件に集中");
  return notes.join("、") || "-";
}

// 返信の宛先アカウントごとの結果。どのアカウントの読者に届くかで、打率が大きく変わる。
function buildParentSection(replies: AnalyticsRow[]): string[] {
  const byParent = new Map<string, AnalyticsRow[]>();
  for (const r of replies) {
    if (!r.parent) continue;
    byParent.set(r.parent, [...(byParent.get(r.parent) ?? []), r]);
  }
  const groups = [...byParent.entries()];
  if (groups.length === 0) return ["宛先を読み取れる返信がありません。"];
  const repeat = groups.filter(([, g]) => g.length >= 2);
  const single = groups.filter(([, g]) => g.length === 1);
  const out: string[] = [];
  out.push(
    `- 宛先は${groups.length}アカウント。2回以上返信したのは${repeat.length}アカウント(返信${repeat.reduce((n, [, g]) => n + g.length, 0)}件)。`
  );
  out.push(
    `- 表示数の中央値(アカウントごとの中央値の中央値): 1回だけ ${median(single.map(([, g]) => median(g.map((r) => r.impressions))))}、` +
      `2回以上 ${median(repeat.map(([, g]) => median(g.map((r) => r.impressions))))}。回数を重ねるだけでは、当たり率は上がらない。`
  );
  out.push("");
  out.push("| 宛先 | 件数 | 表示数の中央値 | 最大 | 合計 | プロフィール |");
  out.push("| --- | --- | --- | --- | --- | --- |");
  for (const [parent, g] of repeat.sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
    const imps = g.map((r) => r.impressions);
    out.push(`| ${parent} | ${g.length} | ${median(imps)} | ${Math.max(...imps).toLocaleString()} | ${sum(g, (r) => r.impressions).toLocaleString()} | ${sum(g, (r) => r.profileVisits)} |`);
  }
  out.push("");
  out.push("(2回以上返信した宛先を、件数の多い順に最大10件。中央値が低い宛先は、通い続ける価値を見直す。)");
  return out;
}

// 返信で反応が良かった言い回し・視点を、親投稿がなくても通じる形に書き直して、自分の投稿にする。
// 反応率の高い返信を、いいね率とブックマーク率から選ぶ(表示数が少なすぎるものは除く)。
function buildPromotionSection(replies: AnalyticsRow[]): string[] {
  const candidates = replies
    .filter((r) => r.impressions >= 300 && r.likes + r.bookmarks >= 3)
    .map((r) => ({ r, score: (r.likes + r.bookmarks * 2) / r.impressions }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (candidates.length === 0) return ["条件(表示300以上、いいね+ブックマーク3以上)を満たす返信がありません。"];
  const out: string[] = [];
  out.push("| 宛先 | 表示 | いいね | ブックマーク | 反応率 | 本文 |");
  out.push("| --- | --- | --- | --- | --- | --- |");
  for (const { r, score } of candidates) {
    out.push(`| ${r.parent} | ${r.impressions.toLocaleString()} | ${r.likes} | ${r.bookmarks} | ${(score * 100).toFixed(2)}% | ${oneLine(r.text.replace(/^@\w+\s*/, ""), 60).replace(/\|/g, "\\|")} |`);
  }
  out.push("");
  out.push(
    "反応率は(いいね + ブックマーク×2)÷表示。使い方: 「親投稿がなくても通じるか」を確かめ、通じなければ場面を足し、型だけを取り出して、自分の保存型の投稿にする(文面はコピーしない)。手順は返信ガイドの「返信を自分の投稿に昇格させる」を参照。"
  );
  return out;
}

const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
};

export function buildAnalyticsReport(rows: AnalyticsRow[], themes: ThemeConfig): string {
  if (rows.length === 0) return "# アナリティクスCSVの分析\n\nデータがありません。";
  const replies = rows.filter((r) => r.isReply);
  const posts = rows.filter((r) => !r.isReply);
  const dates = rows.map((r) => r.date.getTime());
  const from = new Date(Math.min(...dates)).toISOString().slice(0, 10);
  const to = new Date(Math.max(...dates)).toISOString().slice(0, 10);
  const totalImp = sum(rows, (r) => r.impressions);
  const lines: string[] = [];

  lines.push(`# アナリティクスCSVの分析(${from}〜${to}、${rows.length}件)`);
  lines.push("");
  lines.push("## 全体");
  lines.push("");
  lines.push("| 区分 | 件数 | 表示数 | 中央値 | 平均 | いいね | ブックマーク | リポスト | プロフィール | フォロー(投稿別) |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const [label, group] of [["返信(@で始まる)", replies], ["それ以外", posts]] as const) {
    const imp = sum(group, (r) => r.impressions);
    lines.push(
      `| ${label} | ${group.length} | ${imp.toLocaleString()} | ${median(group.map((r) => r.impressions))} | ` +
        `${group.length ? Math.round(imp / group.length) : 0} | ${sum(group, (r) => r.likes)} | ${sum(group, (r) => r.bookmarks)} | ` +
        `${sum(group, (r) => r.reposts)} | ${sum(group, (r) => r.profileVisits)} | ${sum(group, (r) => r.follows)} |`
    );
  }
  lines.push("");
  lines.push(`返信が表示数全体に占める割合: ${pct(sum(replies, (r) => r.impressions), totalImp, 1)}`);
  lines.push("");
  lines.push(
    "注意: 「新しいフォロー」は投稿に紐づく数字で、実際のフォロワー増より大きく少なく出る。フォロワー数は日次で別に記録して見ること。" +
      "また、スレッドへの返信など、本文が@で始まらない返信は「それ以外」に入る。"
  );

  if (replies.length > 0) {
    const repImp = sum(replies, (r) => r.impressions);
    const sortedImp = replies.map((r) => r.impressions).sort((a, b) => b - a);
    lines.push("");
    lines.push("## 返信の表示数の分布");
    lines.push("");
    lines.push("| 表示数 | 件数 | 表示数の合計 | 全体に占める割合 | プロフィール | いいね |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const b of BUCKETS) {
      const group = replies.filter((r) => r.impressions >= b.min && r.impressions < b.max);
      const imp = sum(group, (r) => r.impressions);
      lines.push(`| ${b.label} | ${group.length} | ${imp.toLocaleString()} | ${pct(imp, repImp, 1)} | ${sum(group, (r) => r.profileVisits)} | ${sum(group, (r) => r.likes)} |`);
    }
    const hit = replies.filter((r) => r.impressions >= 1000).length;
    lines.push("");
    lines.push(`- 1,000表示以上の割合(当たり率): ${pct(hit, replies.length, 0)}(${hit}/${replies.length}件)`);
    lines.push(`- 上位1件の割合: ${pct(sortedImp[0], repImp, 0)}、上位3件の割合: ${pct(sortedImp.slice(0, 3).reduce((a, b) => a + b, 0), repImp, 0)}`);
    lines.push(
      `- 返信全体の率(表示数あたり): いいね ${pct(sum(replies, (r) => r.likes), repImp, 3)}、` +
        `ブックマーク ${pct(sum(replies, (r) => r.bookmarks), repImp, 3)}、プロフィール ${pct(sum(replies, (r) => r.profileVisits), repImp, 3)}`
    );

    lines.push("");
    lines.push("## 返信の週別");
    lines.push("");
    lines.push("| 週(月曜) | 件数 | 表示数の中央値 | 1,000表示以上 | 表示数の合計 | プロフィール |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    const weeks = [...new Set(replies.map((r) => weekStart(r.date)))].sort();
    for (const w of weeks) {
      const group = replies.filter((r) => weekStart(r.date) === w);
      lines.push(
        `| ${w} | ${group.length} | ${median(group.map((r) => r.impressions))} | ${group.filter((r) => r.impressions >= 1000).length} | ` +
          `${sum(group, (r) => r.impressions).toLocaleString()} | ${sum(group, (r) => r.profileVisits)} |`
      );
    }

    lines.push("");
    lines.push("## 返信のテーマ別");
    lines.push("");
    lines.push("キーワードによる自動分類(`config/x-reply-themes.json`)。当たり外れの大きい1件に引きずられないよう、中央値も併記する。");
    lines.push("");
    lines.push("| テーマ | 件数 | 表示数の中央値 | 表示数の合計 | 上位1件を除く合計 | いいね率 | ブックマーク率 | プロフィール率 | フォロー(投稿別) | 備考 |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    const labels = [...themes.themes.map((t) => t.label), themes.otherLabel];
    for (const label of labels) {
      const group = replies.filter((r) => r.theme === label);
      if (group.length === 0) continue;
      const imp = sum(group, (r) => r.impressions);
      const top = Math.max(...group.map((r) => r.impressions));
      lines.push(
        `| ${label} | ${group.length} | ${median(group.map((r) => r.impressions))} | ${imp.toLocaleString()} | ` +
          `${(imp - top).toLocaleString()} | ` +
          `${pct(sum(group, (r) => r.likes), imp, 3)} | ${pct(sum(group, (r) => r.bookmarks), imp, 3)} | ` +
          `${pct(sum(group, (r) => r.profileVisits), imp, 3)} | ${sum(group, (r) => r.follows)} | ${themeNote(group.length, top, imp)} |`
      );
    }

    lines.push("");
    lines.push(
      `「サンプル不足」は${MIN_SAMPLE}件未満。「1件に集中」は、表示数の半分以上を上位1件が占める。どちらも、結論ではなく次の仮説として扱う(1つの条件につき${MIN_SAMPLE}件以上は欲しい)。`
    );

    lines.push("");
    lines.push("## 返信の宛先アカウント別");
    lines.push("");
    lines.push(...buildParentSection(replies));

    lines.push("");
    lines.push("## 自分の投稿に昇格させる候補(返信から3件)");
    lines.push("");
    lines.push(...buildPromotionSection(replies));

    lines.push("");
    lines.push("## 表示数の多い返信(上位10件)");
    lines.push("");
    lines.push("| 日付 | テーマ | 表示 | いいね | ブックマーク | プロフィール | 本文 |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const r of [...replies].sort((a, b) => b.impressions - a.impressions).slice(0, 10)) {
      lines.push(
        `| ${r.date.toISOString().slice(0, 10)} | ${r.theme} | ${r.impressions.toLocaleString()} | ${r.likes} | ${r.bookmarks} | ${r.profileVisits} | ${oneLine(r.text, 50).replace(/\|/g, "\\|")} |`
      );
    }
  }

  const urlClicks = rows.filter((r) => r.urlClicks > 0);
  lines.push("");
  lines.push("## URLのクリック");
  lines.push("");
  lines.push(urlClicks.length === 0 ? "クリックはありません。" : `合計 ${sum(urlClicks, (r) => r.urlClicks)}件(${urlClicks.length}投稿)`);
  return lines.join("\n");
}
