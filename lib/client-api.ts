export async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, credentials: "same-origin" });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error || "조회 중 오류가 발생했습니다. 다시 시도해 주세요.");
  }
  return response.json() as Promise<T>;
}
