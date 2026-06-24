import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "./lib/supabase";
import { NalandaApp } from "./NalandaApp";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!supabaseConfigured) return setReady(true);
    supabase!.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase!.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = useCallback(() => {
    supabase!.auth.signOut();
  }, []);

  async function signUp() {
    setMsg("注册中…");
    const { data, error } = await supabase!.auth.signUp({ email, password });
    if (error) return setMsg("注册失败：" + error.message);
    setMsg(
      data.session
        ? "已注册并登录"
        : "注册成功，请查收确认邮件（开发期可在 Supabase 关闭邮箱确认后直接登录）",
    );
  }

  async function signIn() {
    setMsg("登录中…");
    const { error } = await supabase!.auth.signInWithPassword({ email, password });
    setMsg(error ? "登录失败：" + error.message : "");
  }

  // 已登录 → 完整应用
  if (session) return <NalandaApp user={session.user} onSignOut={signOut} />;

  // 未登录 → 居中的登录页
  return (
    <main style={center}>
      <div style={{ textAlign: "center" }}>
        <div style={brand}>Nalanda</div>
        <p style={{ color: "var(--ink-soft)", marginTop: 4 }}>Learn · Create · Share</p>
      </div>

      {!supabaseConfigured ? (
        <p style={notice}>
          未配置 Supabase：在 <code>apps/web/.env.local</code> 设置 VITE_SUPABASE_URL 与
          VITE_SUPABASE_ANON_KEY 后重启。
        </p>
      ) : !ready ? (
        <p style={{ color: "var(--ink-faint)" }}>加载中…</p>
      ) : (
        <div style={card}>
          <input style={input} placeholder="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input style={input} type="password" placeholder="密码" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div style={{ display: "flex", gap: 8 }}>
            <button style={btn} onClick={signIn}>登录</button>
            <button style={{ ...btn, ...btnGhost }} onClick={signUp}>注册</button>
          </div>
          {msg && <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: 0 }}>{msg}</p>}
        </div>
      )}
    </main>
  );
}

const center: CSSProperties = {
  minHeight: "100vh", display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center", gap: 22,
  fontFamily: "var(--font-sans)", padding: 24,
};
const brand: CSSProperties = { fontFamily: "var(--font-serif)", fontSize: 52, fontWeight: 600, letterSpacing: "-.02em" };
const card: CSSProperties = {
  display: "flex", flexDirection: "column", gap: 10, width: 300, padding: 20,
  background: "var(--card)", border: "1px solid var(--border)", borderRadius: 16, boxShadow: "var(--shadow-sm)",
};
const input: CSSProperties = {
  padding: "9px 12px", borderRadius: 10, border: "1px solid var(--border-strong)",
  background: "var(--card-2)", color: "var(--ink)", font: "inherit", outline: "none",
};
const btn: CSSProperties = {
  flex: 1, padding: "9px 14px", borderRadius: 10, border: "1px solid transparent",
  background: "var(--accent)", color: "var(--on-accent)", fontWeight: 600, cursor: "pointer",
};
const btnGhost: CSSProperties = { background: "transparent", color: "var(--ink)", border: "1px solid var(--border-strong)" };
const notice: CSSProperties = { maxWidth: 360, fontSize: 13, color: "var(--ink-soft)", textAlign: "center" };
