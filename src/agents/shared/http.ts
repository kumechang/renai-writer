export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} に失敗しました: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}
