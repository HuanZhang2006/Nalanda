import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { PublicCoursePreview } from "@nalanda/types";
import { coursesApi } from "./api";
import "./courses.css";

export function PublicCourseShare({ token, session, onSignOut }: { token: string; session: Session | null; onSignOut: () => void }) {
  const [course, setCourse] = useState<PublicCoursePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; coursesApi.publicShare(token).then((value) => active && setCourse(value))
    .catch((caught) => active && setError(caught instanceof Error ? caught.message : "分享链接不可用")); return () => { active = false; }; }, [token]);
  const clone = async () => {
    setBusy(true); setError(""); try { await coursesApi.cloneShare(token); window.location.assign("/"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "克隆失败"); setBusy(false); }
  };
  return <main className="course-public-page"><div className="course-public-inner courses-root"><div className="row between"><a href="/" className="brand"><span className="brand-mark">Aa</span><span className="brand-name">Nalanda</span></a>
    {session && <button className="btn btn-sm" onClick={onSignOut}>退出登录</button>}</div>
    {error ? <div className="card card-pad mt-24" role="alert" style={{ color: "var(--pink)" }}>{error}</div> : !course ? <div className="card card-pad mt-24 muted">读取课程预览中…</div> : <>
      <div className="card card-pad mt-24" style={{ background: "linear-gradient(120deg,var(--accent-tint),var(--card))" }}><div className="row between wrap-flex"><div><div className="eyebrow">Shared course · read-only</div>
        <h1 className="page-title">{course.title}</h1><p className="page-sub">作者 {course.authorName} · {course.wordCount} 个词 · {course.hasUnits ? `${course.unitCount} 个单元` : "无单元"}</p></div>
        {session ? <button className="btn btn-primary" disabled={busy} onClick={() => void clone()}>{busy ? "克隆中…" : "免费克隆到我的 Courses"}</button>
          : <a className="btn btn-primary" href={`/?next=${encodeURIComponent(`/shared/courses/${token}`)}`}>登录后免费克隆</a>}</div></div>
      {course.units.map((unit) => <section className="card card-pad mt-16" key={`${unit.position}-${unit.name}`}><h2>{course.hasUnits ? unit.name : "词表预览"}</h2>
        <div className="mt-12">{unit.words.map((word, index) => <div className="list-row" key={`${word.term}-${index}`}><b style={{ minWidth: 180 }}>{word.term}</b>
          <span className="mono faint" style={{ minWidth: 120 }}>{word.ipa || "音标待补充"}</span><span>{word.translations.join(" / ")}</span></div>)}</div></section>)}
    </>}
  </div></main>;
}
