import { useEffect, useRef } from "react";
import type { User } from "@supabase/supabase-js";
// @ts-ignore — ported vanilla module
import { mountNalanda } from "./legacy/app";
import { supabase } from "./lib/supabase";

// 挂载移植自原型的完整应用（壳 + 全部视图），用真实登录用户 + 退出回调参数化
export function NalandaApp({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const signOutRef = useRef(onSignOut);
  signOutRef.current = onSignOut;

  useEffect(() => {
    if (!ref.current) return;
    const cleanup = mountNalanda(ref.current, {
      user: { id: user.id, email: user.email },
      supabase,
      onSignOut: () => signOutRef.current(),
    });
    return cleanup;
    // 令牌刷新不重挂，但同一 React 树内切换账号时必须销毁旧会话状态。
  }, [user.id, user.email]);

  return <div className="app" ref={ref} />;
}
