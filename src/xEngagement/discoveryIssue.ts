import { createIssue, type CreatedIssue } from "../lib/github";
import type { DiscoveredAccount } from "./discoverAccounts";

export const X_ENGAGEMENT_DISCOVERY_LABEL = "x-engagement-discovery";

// 検索で見つかったウォッチ候補アカウントを、運用者が確認しやすい一覧にまとめる。
// 実際にウォッチするかどうかは運用者の判断(config/x-watch-accounts.jsonへの追記)に
// 委ねるため、ここでは提案だけを行う(botが自動でウォッチ対象に加えることはしない)。
export function buildDiscoveryIssueBody(candidates: DiscoveredAccount[]): string {
  if (candidates.length === 0) {
    return [
      "条件に合うアカウントが見つかりませんでした。",
      "`config/x-engagement-discovery.json` の検索キーワード・フォロワー数の範囲を見直してください。",
    ].join("\n");
  }

  const rows = candidates.map((c, i) => {
    const bio = c.description ? c.description : "(bioなし)";
    return [
      `${i + 1}. **@${c.username}**(${c.name}) — フォロワー${c.followersCount.toLocaleString()}人`,
      `   ${bio}`,
      `   検索語: \`${c.matchedQuery}\` / サンプル投稿: ${c.sampleTweetUrl}`,
    ].join("\n");
  });

  return [
    "X APIでの投稿検索から見つかった、ウォッチ候補アカウントです(フォロワー数の多い順)。",
    "内容を確認し、ウォッチしたいアカウントを `config/x-watch-accounts.json` に追記してください。",
    "",
    ...rows,
  ].join("\n\n");
}

export async function createDiscoveryIssue(
  owner: string,
  repo: string,
  candidates: DiscoveredAccount[]
): Promise<CreatedIssue> {
  const title = `Xエンゲージメント: ウォッチ候補アカウント${candidates.length}件`;
  const body = buildDiscoveryIssueBody(candidates);
  return createIssue(owner, repo, title, body, [X_ENGAGEMENT_DISCOVERY_LABEL]);
}
