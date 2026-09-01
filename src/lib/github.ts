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

// 完成した記事をコメントとしてissueに投稿する。読み取りと異なり、
// コメント投稿には常に書き込み権限を持つGITHUB_TOKENが必要。
export async function postIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN が設定されていません(issueへのコメント投稿には issues:write 権限を持つ" +
        "トークンが必要です)"
    );
  }

  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    }
  );
  if (!res.ok) {
    throw new Error(`GitHub issue へのコメント投稿に失敗しました: ${res.status} ${await res.text()}`);
  }
}
