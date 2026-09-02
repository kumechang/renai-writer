// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { checkIssue, startPlan, startResearch, type IssueRef } from "./run";

function parseIssueRef(issue: string): IssueRef {
  const match = issue.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (!match) {
    throw new Error(
      "--issue は owner/repo#番号 の形式で指定してください（例: kumechang/renai-writer#12）"
    );
  }
  const [, owner, repo, number] = match;
  return { owner, repo, number: Number(number) };
}

function getArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

const USAGE =
  "使い方:\n" +
  '  npm run console -- plan --issue owner/repo#番号\n' +
  '  npm run console -- research --issue owner/repo#番号 --title "調査タイトル" --brief "依頼内容"\n' +
  "  npm run console -- check --issue owner/repo#番号";

// Claude AIへの問いかけをClaude.aiのコンソールで手動実行してもらう運用のCLI。
// このスクリプト自身はAnthropic APIを一切呼び出さない。事前にAPIサーバー
// (npm run dev)を起動しておくこと。
async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const apiBaseUrl = process.env.RESEARCH_API_BASE_URL ?? "http://localhost:3000";

  const issueArg = getArg(rest, "--issue");
  if (!command || !issueArg) {
    throw new Error(USAGE);
  }
  const issueRef = parseIssueRef(issueArg);

  let message: string;
  switch (command) {
    case "plan":
      message = await startPlan(issueRef, apiBaseUrl);
      break;
    case "research": {
      const title = getArg(rest, "--title");
      const brief = getArg(rest, "--brief");
      if (!title || !brief) {
        throw new Error(USAGE);
      }
      message = await startResearch(issueRef, title, brief, apiBaseUrl);
      break;
    }
    case "check":
      message = await checkIssue(issueRef, apiBaseUrl);
      break;
    default:
      throw new Error(USAGE);
  }

  console.log(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
