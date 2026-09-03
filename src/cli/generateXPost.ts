// .env は任意。存在すれば読み込む(Node組み込みのloadEnvFileを使用し、依存を増やさない)。
try {
  process.loadEnvFile();
} catch {
  // .env が無い場合はそのまま既存の環境変数を使う
}

import { prisma } from "../db/client";
import { generateXPost } from "../xPoster/pipeline";

interface IssueRef {
  owner: string;
  repo: string;
  number: number;
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

function getArg(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
}

const USAGE =
  "使い方:\n" +
  "  npm run x-post:generate\n" +
  '    → まだXで宣伝していない完成記事(accepted / accepted_with_reservation)の中から\n' +
  "      1件を自動で選んで投稿文を生成する。\n" +
  '  npm run x-post:generate -- --issue owner/repo#番号 [--url "https://記事の公開URL"]\n' +
  "    → 記事(Article)を明示的に指定する場合。--issue には記事が紐づいたsub-issue\n" +
  "      (auto-articleラベルが付いたissue)を指定する。\n" +
  "\n" +
  "--url は --issue を指定した場合のみ有効(自動選択時はどの記事が選ばれるか事前に\n" +
  "分からないため、URLは指定できない)。省略した場合、URLを含まない投稿文を生成する。\n" +
  "\n" +
  "ANTHROPIC_API_KEY(投稿文の生成)、GITHUB_TOKEN(承認issueの作成)、\n" +
  "GITHUB_REPOSITORY(承認issueの作成先、owner/repo形式)が必要です。";

// npm run x-post:generate [-- --issue owner/repo#番号] のエントリポイント。
// ライターが書き上げた記事(Article)をもとに、Xで告知する投稿文をClaude APIで生成し、
// GitHub issueでの人による承認待ちにする(amazon-sentaku-shiageのX自動投稿の仕組みを流用)。
async function main() {
  const argv = process.argv.slice(2);
  const issueArg = getArg(argv, "--issue");
  const url = getArg(argv, "--url");

  if (url && !issueArg) {
    throw new Error(USAGE);
  }

  if (!issueArg) {
    const result = await generateXPost();
    printResult(result);
    return;
  }

  const issueRef = parseIssueRef(issueArg);
  const session = await prisma.issueSession.findUnique({
    where: {
      issueOwner_issueRepo_issueNumber: {
        issueOwner: issueRef.owner,
        issueRepo: issueRef.repo,
        issueNumber: issueRef.number,
      },
    },
  });
  if (!session?.articleId) {
    throw new Error(`このissueには記事(Article)が紐づいていません: ${issueArg}`);
  }

  const result = await generateXPost({ articleId: session.articleId, articleUrl: url });
  printResult(result);
}

function printResult(result: Awaited<ReturnType<typeof generateXPost>>): void {
  console.log(`記事「${result.articleTitle}」のX投稿を生成しました(status=${result.status}, スコア=${result.score}点)`);
  console.log("---");
  console.log(result.finalText);
  console.log("---");
  if (result.githubIssueUrl) {
    console.log(`承認issue: ${result.githubIssueUrl}`);
  } else {
    console.log("GITHUB_TOKEN未設定のため承認issueは作成していません(DB上にのみ記録)。");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
