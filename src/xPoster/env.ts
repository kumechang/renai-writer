// X (Twitter) API認証情報の読み込み。未設定でも空文字で扱い、hasXCredentials() を
// 「キーが無いのでドライランする」判定に使う(APIキー未取得の段階でも処理を止めないため)。
export const xEnv = {
  apiKey: process.env.X_API_KEY ?? "",
  apiSecret: process.env.X_API_SECRET ?? "",
  accessToken: process.env.X_ACCESS_TOKEN ?? "",
  accessSecret: process.env.X_ACCESS_SECRET ?? "",
};

export function hasXCredentials(): boolean {
  return (
    xEnv.apiKey.length > 0 &&
    xEnv.apiSecret.length > 0 &&
    xEnv.accessToken.length > 0 &&
    xEnv.accessSecret.length > 0
  );
}

// 承認issueをどのリポジトリに作るか。GitHub Actions上では `github.repository` が
// 自動で入るが、ローカル実行時は .env に GITHUB_REPOSITORY=owner/repo を設定する。
export function parseGithubRepository(): { owner: string; repo: string } | null {
  const value = process.env.GITHUB_REPOSITORY ?? "";
  const parts = value.split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { owner: parts[0], repo: parts[1] };
}
