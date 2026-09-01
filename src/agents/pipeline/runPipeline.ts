// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { fetchGithubIssue } from "../../lib/github";
import { runArticlePipeline } from "./run";

interface ParsedArgs {
  theme?: string;
  issue?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--theme") {
      args.theme = argv[i + 1];
      i += 1;
    } else if (argv[i] === "--issue") {
      args.issue = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

async function resolveTheme(args: ParsedArgs): Promise<string> {
  if (args.theme) return args.theme;

  if (args.issue) {
    const match = args.issue.match(/^([^/]+)\/([^#]+)#(\d+)$/);
    if (!match) {
      throw new Error(
        "--issue は owner/repo#番号 の形式で指定してください（例: kumechang/renai-writer#12）"
      );
    }
    const [, owner, repo, number] = match;
    const issue = await fetchGithubIssue(owner, repo, Number(number));
    return `${issue.title}\n\n${issue.body}`;
  }

  throw new Error('使い方: npm run pipeline -- --theme "テーマ" もしくは --issue owner/repo#番号');
}

// テーマ(直接指定 or GitHub issue)から、企画立案→執筆→レビュー→(必要なら)修正まで
// 一気通貫で実行するCLIエントリポイント。事前にAPIサーバー(npm run dev)を起動しておくこと。
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const theme = await resolveTheme(args);

  const apiBaseUrl = process.env.RESEARCH_API_BASE_URL ?? "http://localhost:3000";
  const collectedBy = process.env.RESEARCHER_AGENT_NAME ?? "claude-researcher-agent";

  const result = await runArticlePipeline(theme, { apiBaseUrl, collectedBy });

  console.log("\n=== パイプライン完了 ===");
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
