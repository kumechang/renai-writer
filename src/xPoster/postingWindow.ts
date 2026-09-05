import type { XPosterConfig } from "./config";
import { getJstHour } from "./time";

// ターゲット読者が投稿を見ていて不自然でない時間帯かどうか。GitHub Actionsのscheduleは
// 数時間単位で遅延することがあり、深夜にズレ込んで実行されることがあるため、
// そういう回は投稿候補自体を作らずスキップする(amazon-sentaku-shiageのpostingWindow.tsを流用)。
export function isWithinPostingWindow(date: Date, config: XPosterConfig): boolean {
  const hour = getJstHour(date);
  const { startHour, endHour } = config.postingWindow;
  return hour >= startHour && hour < endHour;
}
