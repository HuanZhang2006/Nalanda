import { supabase } from "./supabase";

// 带上 Supabase 登录令牌请求后端
export async function authedFetch(path: string, init: RequestInit = {}) {
  const sessionResult = await supabase?.auth.getSession();
  if (sessionResult?.error) throw sessionResult.error;
  const token = sessionResult?.data.session?.access_token;
  return fetch(path, {
    ...init,
    headers: {
      ...init.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fieldErrors?: Record<string, string>,
  ) { super(message); }
}

export async function apiJson<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  const response = authenticated ? await authedFetch(path, init) : await fetch(path, init);
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    throw new ApiClientError(response.status, String(body?.code || "REQUEST_FAILED"),
      String(body?.message || "请求失败"), body?.fieldErrors as Record<string, string> | undefined);
  }
  return body as T;
}
