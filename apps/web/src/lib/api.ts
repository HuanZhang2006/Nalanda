import { supabase } from "./supabase";

// 带上 Supabase 登录令牌请求后端
export async function authedFetch(path: string, init: RequestInit = {}) {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  return fetch(path, {
    ...init,
    headers: {
      ...init.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}
