import { useCallback, useEffect, useState, type CSSProperties } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "./lib/supabase";
import { NalandaApp } from "./NalandaApp";
import { PublicCourseShare } from "./features/courses/PublicCourseShare";

type Mode = "signin" | "signup";

const REG_ERR: Record<string, string> = {
  EMAIL_TAKEN: "该邮箱已注册，请切换到「登录」",
  WEAK_PASSWORD: "密码至少 6 位",
  INVALID_EMAIL: "邮箱格式不正确",
  UPSTREAM_UNREACHABLE: "服务暂时不可用，请稍后再试",
  RATE_LIMITED: "注册请求过于频繁，请按提示等待后重试",
  RATE_LIMIT_UNAVAILABLE: "注册保护服务暂不可用，请稍后重试",
};

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [theme, setThemeState] = useState("light");

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let active = true;
    const t = localStorage.getItem("nalanda-theme") ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", t);
    setThemeState(t);
    if (!supabaseConfigured) return setReady(true);
    supabase!.auth.getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setErr("无法读取登录状态，请刷新重试");
        if (data.session) restoreRequestedPath();
        setSession(data.session);
        setReady(true);
      })
      .catch(() => {
        if (!active) return;
        setErr("无法读取登录状态，请刷新重试");
        setReady(true);
      });
    const { data: sub } = supabase!.auth.onAuthStateChange((_e, s) => {
      if (!active) return;
      if (s) restoreRequestedPath();
      setSession(s);
      // submit 成功依赖 auth 事件完成跳转；任何会话切换都要结束按钮 loading。
      setLoading(false);
      if (s) setErr("");
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const toggleTheme = useCallback(() => {
    const t = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    localStorage.setItem("nalanda-theme", t);
    setThemeState(t);
  }, []);

  const signOut = useCallback(async () => {
    setErr("");
    try {
      const { error } = await supabase!.auth.signOut();
      if (error) setErr("退出登录失败，请检查网络后重试");
    } catch {
      setErr("退出登录失败，请检查网络后重试");
    }
  }, []);

  const em = email.trim().toLowerCase();
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em);
  const pwOk = password.length >= 6;
  const canSubmit = emailOk && pwOk && !loading;
  const shareToken = window.location.pathname.match(/^\/shared\/courses\/([A-Za-z0-9_-]{40,60})\/?$/)?.[1];

  async function submit() {
    if (!canSubmit) return;
    setErr(""); setLoading(true);
    try {
      if (mode === "signup") {
        const r = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: em, password }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          const code = (j && (j.code || (j.message && j.message.code))) || "";
          const retry = Number(j?.retryAfterSeconds || 0);
          setErr(`${REG_ERR[code] || "注册失败，请重试"}${retry > 0 ? `（约 ${retry} 秒后恢复）` : ""}`);
          setLoading(false);
          return;
        }
      }
      const { error } = await supabase!.auth.signInWithPassword({ email: em, password });
      if (error) {
        setErr(mode === "signup" ? "注册成功，但自动登录失败，请用「登录」重试" : "邮箱或密码错误");
        setLoading(false);
      }
      // 成功后 onAuthStateChange 触发，组件切换到应用
    } catch {
      setErr("网络错误，请重试");
      setLoading(false);
    }
  }

  if (shareToken && ready) return <PublicCourseShare token={shareToken} session={session} onSignOut={signOut} />;

  if (session) return (
    <>
      <NalandaApp user={session.user} onSignOut={signOut} />
      {err && <div role="alert" style={sessionErrBox}>{err}</div>}
    </>
  );

  return (
    <div style={screen}>
      <button onClick={toggleTheme} style={themeBtn} title="切换主题" aria-label="切换主题">
        {theme === "dark" ? "☀" : "☾"}
      </button>

      <div style={card}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={mark} aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
              strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3h9l4 4v14H6z" /><path d="M15 3v4h4" /><path d="M9 12h7M9 16h7M9 8h3" />
            </svg>
          </div>
          <div style={{ fontFamily: "var(--font-serif)", fontSize: 30, fontWeight: 600, letterSpacing: "-.02em" }}>
            Nalanda
          </div>
          <div style={{ color: "var(--ink-faint)", fontSize: 12.5, letterSpacing: ".14em", textTransform: "uppercase", marginTop: 2 }}>
            Learn · Create · Share
          </div>
        </div>

        {!supabaseConfigured ? (
          <p style={{ fontSize: 13, color: "var(--ink-soft)", textAlign: "center" }}>
            未配置 Supabase：请在 <code>apps/web/.env.local</code> 设置后重启。
          </p>
        ) : !ready ? (
          <p style={{ color: "var(--ink-faint)", textAlign: "center" }}>加载中…</p>
        ) : (
          <>
            <div style={seg}>
              {(["signin", "signup"] as Mode[]).map((m) => (
                <button key={m} onClick={() => { setMode(m); setErr(""); }}
                  style={{ ...segBtn, ...(mode === m ? segBtnActive : {}) }}>
                  {m === "signin" ? "登录" : "注册"}
                </button>
              ))}
            </div>

            <label style={lbl}>邮箱</label>
            <input style={field} type="email" autoComplete="email" placeholder="you@school.edu"
              value={email} onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()} />

            <label style={{ ...lbl, marginTop: 12 }}>密码</label>
            <div style={{ position: "relative" }}>
              <input style={{ ...field, paddingRight: 56 }} type={showPw ? "text" : "password"}
                autoComplete={mode === "signin" ? "current-password" : "new-password"}
                placeholder={mode === "signup" ? "至少 6 位" : "密码"}
                value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()} />
              <button type="button" onClick={() => setShowPw((v) => !v)} style={pwToggle}>
                {showPw ? "隐藏" : "显示"}
              </button>
            </div>

            {err && <div style={errBox}>{err}</div>}

            <button onClick={submit} disabled={!canSubmit} style={{ ...primary, ...(canSubmit ? {} : disabledBtn) }}>
              {loading ? "处理中…" : mode === "signin" ? "登录" : "注册并进入"}
            </button>

            <p style={{ fontSize: 12, color: "var(--ink-faint)", textAlign: "center", marginTop: 14 }}>
              {mode === "signin" ? "还没有账号？" : "已有账号？"}{" "}
              <a onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setErr(""); }}
                style={{ color: "var(--accent)", cursor: "pointer", fontWeight: 600 }}>
                {mode === "signin" ? "去注册" : "去登录"}
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function restoreRequestedPath() {
  const next = new URLSearchParams(window.location.search).get("next");
  if (next?.startsWith("/shared/courses/") && !next.includes("..") && !next.includes("//")) {
    window.history.replaceState(null, "", next);
  }
}

const screen: CSSProperties = {
  minHeight: "100vh", display: "grid", placeItems: "center", padding: 24,
  background: "var(--bg)", fontFamily: "var(--font-sans)", position: "relative",
};
const themeBtn: CSSProperties = {
  position: "absolute", top: 18, right: 18, width: 38, height: 38, borderRadius: 10,
  border: "1px solid var(--border)", background: "var(--card)", color: "var(--ink-soft)",
  cursor: "pointer", fontSize: 16,
};
const card: CSSProperties = {
  width: 380, maxWidth: "92vw", padding: 28, background: "var(--card)",
  border: "1px solid var(--border)", borderRadius: 18, boxShadow: "var(--shadow-md)",
};
const mark: CSSProperties = {
  width: 44, height: 44, borderRadius: 12, margin: "0 auto 12px",
  background: "radial-gradient(circle at 32% 28%, var(--accent-2), var(--accent) 70%)",
  color: "var(--on-accent)", display: "grid", placeItems: "center", boxShadow: "var(--shadow-sm)",
};
const seg: CSSProperties = {
  display: "flex", gap: 3, background: "var(--shade-2)", borderRadius: 11, padding: 3, marginBottom: 20,
};
const segBtn: CSSProperties = {
  flex: 1, border: 0, background: "transparent", color: "var(--ink-soft)", fontWeight: 600,
  fontSize: 13.5, padding: "8px 4px", borderRadius: 8, cursor: "pointer",
};
const segBtnActive: CSSProperties = { background: "var(--card)", color: "var(--accent)", boxShadow: "var(--shadow-sm)" };
const lbl: CSSProperties = { display: "block", fontSize: 12, fontWeight: 600, color: "var(--ink-soft)", marginBottom: 6 };
const field: CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10,
  border: "1px solid var(--border-strong)", background: "var(--card-2)", color: "var(--ink)",
  font: "inherit", fontSize: 14, outline: "none",
};
const pwToggle: CSSProperties = {
  position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
  border: 0, background: "transparent", color: "var(--ink-faint)", cursor: "pointer", fontSize: 12.5, fontWeight: 600,
};
const errBox: CSSProperties = {
  marginTop: 14, padding: "9px 12px", borderRadius: 9, fontSize: 13,
  background: "color-mix(in srgb, var(--pink) 14%, var(--card))", color: "var(--pink)",
  border: "1px solid color-mix(in srgb, var(--pink) 30%, var(--border))",
};
const primary: CSSProperties = {
  width: "100%", marginTop: 18, padding: "11px 16px", borderRadius: 10, border: "1px solid transparent",
  background: "var(--accent)", color: "var(--on-accent)", fontWeight: 600, fontSize: 14.5, cursor: "pointer",
  boxShadow: "var(--shadow-sm)",
};
const disabledBtn: CSSProperties = { opacity: 0.5, cursor: "not-allowed", boxShadow: "none" };
const sessionErrBox: CSSProperties = {
  position: "fixed", right: 18, bottom: 18, zIndex: 100, maxWidth: 360,
  padding: "10px 14px", borderRadius: 10, background: "var(--card)", color: "var(--pink)",
  border: "1px solid color-mix(in srgb, var(--pink) 35%, var(--border))", boxShadow: "var(--shadow-md)",
};
