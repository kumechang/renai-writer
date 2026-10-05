import { readFileSync, writeFileSync } from "node:fs";
import { buildAnalyticsReport, loadThemeConfig, parseAnalyticsCsv } from "../analytics/xAnalyticsReport";

// npm run x-analytics:report -- <CSVのパス> [--out <出力先.md>]
// Xのアナリティクス(コンテンツ)からエクスポートしたCSVを集計して、markdownのレポートを出す。
function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const out = outIndex >= 0 ? args[outIndex + 1] : undefined;
  const valueIndex = outIndex >= 0 ? outIndex + 1 : -1;
  const file = args.find((a, i) => !a.startsWith("--") && i !== valueIndex);
  if (!file) {
    console.error("使い方: npm run x-analytics:report -- <CSVのパス> [--out <出力先.md>]");
    process.exit(1);
  }
  const themes = loadThemeConfig();
  const rows = parseAnalyticsCsv(readFileSync(file, "utf-8"), themes);
  const report = buildAnalyticsReport(rows, themes);
  if (out) {
    writeFileSync(out, `${report}\n`, "utf-8");
    console.log(`written: ${out}`);
  } else {
    console.log(report);
  }
}

main();
