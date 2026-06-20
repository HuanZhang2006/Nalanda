import { useEffect, useState } from "react";

type Health = { status: string; deps?: Record<string, string> };

export function App() {
  const [msg, setMsg] = useState("checking API…");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json() as Promise<Health>)
      .then((d) => setMsg(d.status === "ok" ? "API 已连通 ✓" : "API 异常"))
      .catch(() => setMsg("API 未连通（后端未启动？）"));
  }, []);

  return (
    <main style={{ textAlign: "center", fontFamily: "var(--font-sans)", padding: 24 }}>
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 52,
          fontWeight: 600,
          letterSpacing: "-.02em",
        }}
      >
        Nalanda
      </div>
      <p style={{ color: "var(--ink-soft)", marginTop: 4 }}>Learn · Create · Share</p>
      <p style={{ color: "var(--ink-faint)", fontSize: 13, marginTop: 18 }}>{msg}</p>
    </main>
  );
}
