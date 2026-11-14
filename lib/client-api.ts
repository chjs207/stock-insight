import { pagesRequest } from "../src/runtime";

export async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  if (options?.signal?.aborted) throw new DOMException("요청이 취소되었습니다.", "AbortError");
  const result = await pagesRequest<T>(url, options);
  if (options?.signal?.aborted) throw new DOMException("요청이 취소되었습니다.", "AbortError");
  return result;
}
