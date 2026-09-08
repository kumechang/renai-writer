import type { XEngagementConfig } from "./config";
import { getJstHour } from "../xPoster/time";

// ターゲット読者(および憧れのアカウント本人)が投稿を見ていて不自然でない時間帯かどうか。
// src/xPoster/postingWindow.tsと同じ考え方。
export function isWithinReplyWindow(date: Date, config: XEngagementConfig): boolean {
  const hour = getJstHour(date);
  const { startHour, endHour } = config.replyWindow;
  return hour >= startHour && hour < endHour;
}
