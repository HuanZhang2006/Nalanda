import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { PublicCoursePreview } from "@nalanda/types";
import { coursesApi } from "./api";
import { useI18n } from "../../i18n";
import { CourseLocaleButton } from "./CourseLocaleButton";
import "./courses.css";

export function PublicCourseShare({ token, session, onSignOut }: { token: string; session: Session | null; onSignOut: () => void }) {
  const { l } = useI18n();
  const [course, setCourse] = useState<PublicCoursePreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; coursesApi.publicShare(token).then((value) => active && setCourse(value))
    .catch((caught) => active && setError(caught instanceof Error ? caught.message : l("This share link is unavailable.", "分享链接不可用"))); return () => { active = false; }; }, [token, l]);
  const clone = async () => {
    setBusy(true); setError(""); try { await coursesApi.cloneShare(token); window.location.assign("/"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : l("Could not clone the course.", "克隆失败")); setBusy(false); }
  };
  return <main className="course-public-page"><div className="course-public-inner courses-root"><div className="row between"><a href="/" className="brand"><span className="brand-mark">Aa</span><span className="brand-name">Nalanda</span></a>
    <div className="row"><CourseLocaleButton />{session && <button className="btn btn-sm" onClick={onSignOut}>{l("Sign out", "退出登录")}</button>}</div></div>
    {error ? <div className="card card-pad mt-24" role="alert" style={{ color: "var(--pink)" }}>{error}</div> : !course ? <div className="card card-pad mt-24 muted">{l("Loading course preview…", "读取课程预览中…")}</div> : <>
      <div className="card card-pad mt-24" style={{ background: "linear-gradient(120deg,var(--accent-tint),var(--card))" }}><div className="row between wrap-flex"><div><div className="eyebrow">{l("Shared course · read-only", "共享课程 · 只读")}</div>
        <h1 className="page-title">{course.title}</h1><p className="page-sub">{l(`By ${course.authorName} · ${course.wordCount} words · ${course.hasUnits ? `${course.unitCount} units` : "No units"}`, `作者 ${course.authorName} · ${course.wordCount} 个词 · ${course.hasUnits ? `${course.unitCount} 个单元` : "无单元"}`)}</p></div>
        {session ? <button className="btn btn-primary" disabled={busy} onClick={() => void clone()}>{busy ? l("Cloning…", "克隆中…") : l("Clone to my Courses for free", "免费克隆到我的 Courses")}</button>
          : <a className="btn btn-primary" href={`/?next=${encodeURIComponent(`/shared/courses/${token}`)}`}>{l("Sign in to clone for free", "登录后免费克隆")}</a>}</div></div>
      {course.units.map((unit) => <section className="card card-pad mt-16" key={`${unit.position}-${unit.name}`}><h2>{course.hasUnits ? unit.name : l("Vocabulary preview", "词表预览")}</h2>
        <div className="mt-12">{unit.words.map((word, index) => <div className="list-row" key={`${word.term}-${index}`}><b style={{ minWidth: 180 }}>{word.term}</b>
          <span className="mono faint" style={{ minWidth: 120 }}>{word.ipa || l("IPA not available", "音标待补充")}</span><span>{word.translations.join(" / ")}</span></div>)}</div></section>)}
    </>}
  </div></main>;
}
