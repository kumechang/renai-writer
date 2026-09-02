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

export interface PostedComment {
  id: number;
  createdAt: string;
}

// コメントをissueに投稿する。常に書き込み権限を持つGITHUB_TOKENが必要。
export async function postIssueComment(
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<PostedComment> {
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
  const data = (await res.json()) as { id: number; created_at: string };
  return { id: data.id, createdAt: data.created_at };
}

export interface IssueComment {
  id: number;
  body: string;
  createdAt: string;
}

// issueのコメント一覧を取得する(古い順)。コンソールでの回答を探すのに使う。
export async function listIssueComments(
  owner: string,
  repo: string,
  issueNumber: number
): Promise<IssueComment[]> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
    }
  );
  if (!res.ok) {
    throw new Error(`GitHub issue のコメント取得に失敗しました: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as Array<{ id: number; body: string | null; created_at: string }>;
  return data.map((c) => ({ id: c.id, body: c.body ?? "", createdAt: c.created_at }));
}

function requireGithubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN が設定されていません(issues:write 権限を持つトークンが必要です)"
    );
  }
  return token;
}

export interface CreatedSubIssue {
  number: number;
  url: string;
}

// AUTO_ARTICLE_LABEL が付いたissueは、記事1本を担当するsub-issueであることを示す。
// テーマissueに対するプロンプト生成(console-plan.yml)を誤発火させないためのマーカー。
export const AUTO_ARTICLE_LABEL = "auto-article";

// 親issue配下にsub-issue(1記事に対応)を作成する。
// GitHubのsub-issue APIはissueのnumberではなくid(グローバルID)で親子を紐づける。
export async function createSubIssue(
  owner: string,
  repo: string,
  parentIssueNumber: number,
  title: string,
  body: string
): Promise<CreatedSubIssue> {
  const token = requireGithubToken();
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title, body, labels: [AUTO_ARTICLE_LABEL] }),
  });
  if (!createRes.ok) {
    throw new Error(`sub-issueの作成に失敗しました: ${createRes.status} ${await createRes.text()}`);
  }
  const created = (await createRes.json()) as { id: number; number: number; html_url: string };

  const linkRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${parentIssueNumber}/sub_issues`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ sub_issue_id: created.id }),
    }
  );
  if (!linkRes.ok) {
    throw new Error(
      `sub-issueの親issueへの紐付けに失敗しました: ${linkRes.status} ${await linkRes.text()}`
    );
  }

  return { number: created.number, url: created.html_url };
}
