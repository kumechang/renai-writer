export interface GithubIssue {
  title: string;
  body: string;
}

function requireGithubTokenForWrite(action: string): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(`GITHUB_TOKEN が設定されていません(${action}には issues:write 権限を持つトークンが必要です)`);
  }
  return token;
}

export interface CreatedIssue {
  number: number;
  url: string;
}

// ラベル付きのissueを新規作成する(X投稿承認issueなど、既存issueと独立した用途に使う)。
export async function createIssue(
  owner: string,
  repo: string,
  title: string,
  body: string,
  labels: string[]
): Promise<CreatedIssue> {
  const token = requireGithubTokenForWrite("issueの作成");
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, body, labels }),
  });
  if (!res.ok) {
    throw new Error(`issueの作成に失敗しました: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { number: number; html_url: string };
  return { number: data.number, url: data.html_url };
}

// issueをクローズする(処理結果のコメントは別途 postIssueComment で行う)。
export async function closeIssue(owner: string, repo: string, issueNumber: number): Promise<void> {
  const token = requireGithubTokenForWrite("issueのクローズ");
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ state: "closed" }),
  });
  if (!res.ok) {
    throw new Error(`issueのクローズに失敗しました: ${res.status} ${await res.text()}`);
  }
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

export type GithubIssueState = "open" | "closed";

// issueがopen/closedのどちらかを取得する。X投稿生成で、記事issueがまだオープン(=まだ
// 他媒体に公開していない)か、クローズ済み(=公開済み、内容を自由に紹介してよい)かの
// 判定に使う。
export async function getIssueState(owner: string, repo: string, issueNumber: number): Promise<GithubIssueState> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub issue の状態取得に失敗しました: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { state: string };
  return data.state === "closed" ? "closed" : "open";
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

const URL_PATTERN = /https?:\/\/\S+/;

// 記事issueの最後のコメントからURLを抜き出す。運用者が「記事を公開したら最後のコメントに
// URLを貼る」運用をしている前提(X投稿生成が、公開済み記事のURLをここから拾う)。
// 直近100件のコメントまでしか見ないため、それより古いコメントにしかURLが無い場合は
// 拾えない(通常の運用では起こらない想定)。
export async function getLastCommentUrl(owner: string, repo: string, issueNumber: number): Promise<string | null> {
  const comments = await listIssueComments(owner, repo, issueNumber);
  if (comments.length === 0) return null;
  const lastComment = comments[comments.length - 1];
  const match = lastComment.body.match(URL_PATTERN);
  return match ? match[0] : null;
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
