// JST関連の時刻計算をまとめたユーティリティ(amazon-sentaku-shiageのlib/time.tsを流用)。
// en-USロケール + hour12:false で取得する。日本語ロケールでは単位付き文字列になり
// Number()がNaNになることがあるため避ける。深夜0時をhour12:falseで取得すると
// "24"を返す実装があるため0に正規化する。
export function getJstHour(date: Date): number {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "numeric", hour12: false })
    .formatToParts(date)
    .find((p) => p.type === "hour");
  const hour = Number(part?.value);
  return hour === 24 ? 0 : hour;
}

// JSTでの日付を "YYYY-MM-DD" で返す。1日の投稿数カウントなど、JSTのカレンダー日で
// 区切りたい場面向け。en-CAロケールはハイフン区切りのYYYY-MM-DDを返すため利用する。
export function getJstDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(date);
}
