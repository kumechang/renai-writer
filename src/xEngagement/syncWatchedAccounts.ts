import type { WatchedAccount } from "@prisma/client";
import { prisma } from "../db/client";
import { loadWatchAccountsConfig } from "./watchAccountsConfig";

// config/x-watch-accounts.json の内容をWatchedAccountテーブルに反映する。
// ファイルに無いアカウントは削除せずactive=falseにするだけに留める
// (誤って外した場合でも、過去のWatchedPost/EngagementReplyの履歴を失わないため)。
export async function syncWatchedAccounts(): Promise<WatchedAccount[]> {
  const entries = loadWatchAccountsConfig();
  const usernames = new Set(entries.map((e) => e.username));

  const synced: WatchedAccount[] = [];
  for (const entry of entries) {
    const account = await prisma.watchedAccount.upsert({
      where: { username: entry.username },
      create: { username: entry.username, note: entry.note ?? null, active: true },
      update: { note: entry.note ?? null, active: true },
    });
    synced.push(account);
  }

  const existing = await prisma.watchedAccount.findMany({ where: { active: true } });
  for (const account of existing) {
    if (!usernames.has(account.username)) {
      await prisma.watchedAccount.update({ where: { id: account.id }, data: { active: false } });
    }
  }

  return synced;
}
