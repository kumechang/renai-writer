// twitter-api-v2 の ApiResponseError は実際のAPIエラー本文を .data に持つが、
// String(error) だとそれが失われ「Request failed with code 403」としか分からない。
// X API側の詳細(title/detail/reason/errors)を可能な限り拾って人が読める形にする
// (amazon-sentaku-shiageのxErrorMessage.tsを流用)。
export function describeXApiError(error: unknown): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: unknown }).data;
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      const parts: string[] = [];
      if (typeof d.title === "string") parts.push(d.title);
      if (typeof d.detail === "string") parts.push(d.detail);
      if (typeof d.reason === "string") parts.push(`reason=${d.reason}`);
      if (Array.isArray(d.errors) && d.errors.length > 0) parts.push(JSON.stringify(d.errors));
      if (parts.length > 0) return parts.join(" / ");
    }
  }
  return String(error);
}
