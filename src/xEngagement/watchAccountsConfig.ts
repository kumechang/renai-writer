import { readFileSync } from "node:fs";
import path from "node:path";

export interface WatchAccountEntry {
  username: string;
  note?: string;
}

const CONFIG_PATH = path.resolve(process.cwd(), "config/x-watch-accounts.json");

// config/x-watch-accounts.json (運用者が「フォロワー1万人以上の憧れのアカウント」を
// 5〜10件程度登録するファイル)を読み込む。DBのWatchedAccountはこのファイルの内容を
// syncWatchedAccountsで同期して使う(登録はJSON編集だけで完結させ、DB操作を不要にするため)。
export function loadWatchAccountsConfig(): WatchAccountEntry[] {
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const parsed = JSON.parse(raw) as WatchAccountEntry[];
  return parsed.filter((entry) => entry.username && entry.username !== "example_account");
}
