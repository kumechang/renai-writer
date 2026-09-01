export interface GithubIssue {
  title: string;
  body: string;
}

// テーマを記載したGitHub issueの本文を取得する。
// GITHUB_TOKEN が設定されていればprivateリポジトリにも対応する。
export async function fetchGithubIssue(
  owner: string,
  repo: string,
  issueNumber: number
): Promise<GithubIssue> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub issue の取得に失敗しました: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { title: string; body: string | null };
  return { title: data.title, body: data.body ?? "" };
}
