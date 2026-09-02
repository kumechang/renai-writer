// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { fetchGithubIssue, postIssueComment } from "../../lib/github";
import { fetchJson } from "../shared/http";
import type { DraftResponse } from "../shared/types";
import { formatArticleComment } from "./formatComment";
import { runArticlePipeline } from "./run";

interface ParsedArgs {
  theme?: string;
  issue?: string;
}

interface IssueRef {
  owner: string;
  repo: string;
  number: number;
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

async function resolveTheme(args: ParsedArgs): Promise<{ theme: string; issueRef?: IssueRef }> {
  if (args.theme) return { theme: args.theme };

  if (args.issue) {
    const issueRef = parseIssueRef(args.issue);
    const issue = await fetchGithubIssue(issueRef.owner, issueRef.repo, issueRef.number);
    return { theme: `${issue.title}\n\n${issue.body}`, issueRef };
  }

  throw new Error('使い方: npm run pipeline -- --theme "テーマ" もしくは --issue owner/repo#番号');
}

// テーマ(直接指定 or GitHub issue)から、企画立案→執筆→レビュー→(必要なら)修正まで
// 一気通貫で実行するCLIエントリポイント。事前にAPIサーバー(npm run dev)を起動しておくこと。
// --issue で実行した場合、完成した記事を同じissueにコメントとして投稿する
// (GITHUB_TOKEN に issues:write 権限が必要)。
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { theme, issueRef } = await resolveTheme(args);

  const apiBaseUrl = process.env.RESEARCH_API_BASE_URL ?? "http://localhost:3000";
  const collectedBy = process.env.RESEARCHER_AGENT_NAME ?? "claude-researcher-agent";

  const result = await runArticlePipeline(theme, { apiBaseUrl, collectedBy });

  console.log("\n=== パイプライン完了 ===");
  console.log(JSON.stringify(result, null, 2));

  if (issueRef) {
    const draft = await fetchJson<DraftResponse>(
      `${apiBaseUrl}/api/plans/${result.planId}/articles/${result.articleId}/drafts/${result.finalDraftId}`
    );

    console.log(`\n=== GitHub issue へ記事を投稿中: ${args.issue} ===`);
    await postIssueComment(
      issueRef.owner,
      issueRef.repo,
      issueRef.number,
      formatArticleComment(draft, result)
    );
    console.log("投稿が完了しました。");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
