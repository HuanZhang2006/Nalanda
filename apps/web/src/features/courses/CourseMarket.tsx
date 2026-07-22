import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { PublicCoursePreview } from "@nalanda/types";
import { coursesApi } from "./api";
import { useI18n } from "../../i18n";
import "./courses.css";

export function CourseMarket({ toast = () => {}, navigateCourses = () => {} }: {
  toast?: (message: string, icon?: string) => void;
  navigateCourses?: () => void;
}) {
  const { l } = useI18n();
  const [items, setItems] = useState<PublicCoursePreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const load = () => { setLoading(true); coursesApi.market().then((value) => { setItems(value); setError(""); })
    .catch((caught) => setError(caught instanceof Error ? caught.message : l("Could not load the course market.", "课程市场加载失败"))).finally(() => setLoading(false)); };
  useEffect(load, []);
  const clone = async (item: PublicCoursePreview) => {
    setBusy(item.id); setError("");
    try { await coursesApi.clonePublication(item.publicationId || item.id); toast(l("Cloned to Courses for free with 0% progress", "已免费克隆到 Courses，学习进度为 0%"), "check"); navigateCourses(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : l("Could not clone the course.", "克隆失败")); setBusy(""); }
  };
  const report = async (item: PublicCoursePreview) => {
    const details = window.prompt(l("Briefly explain the report. Reports do not automatically unpublish a course.", "请简要说明举报原因（不会因举报数量自动下架）"), "")?.trim(); if (!details) return;
    try { await coursesApi.report({ publicationId: item.publicationId || item.id, category: "other", details }); toast(l("Report submitted for review", "举报已提交审核"), "check"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : l("Could not submit the report.", "举报失败")); }
  };
  if (loading) return <div className="card card-pad muted">{l("Loading the free course market…", "加载免费课程市场中…")}</div>;
  return <div className="courses-root">{error && <div role="alert" className="course-feedback wrong">{error}<button className="btn btn-sm" style={{ marginLeft: 10 }} onClick={load}>{l("Retry", "重试")}</button></div>}
    {!items.length ? <div className="course-empty"><div className="course-empty-icon">Aa</div><h2>{l("The course market is empty", "课程市场暂时为空")}</h2><p className="muted mt-8">{l("Published text courses will appear here.", "作者发布第一个文本课程后会显示在这里。")}</p></div>
      : <div className="course-market-grid">{items.map((item) => <article className="card card-pad hoverable" key={item.id}>
        <div className="row between"><span className="chip chip-accent">{l("English vocabulary", "英语单词")}</span><b style={{ color: "var(--good)" }}>{l("Free", "免费")}</b></div>
        <h2 className="serif mt-12" style={{ fontSize: 19 }}>{item.title}</h2><p className="muted mt-8">{item.description || l("No description provided", "作者未填写简介")}</p>
        <p className="faint mt-12">{item.hasUnits ? l(`${item.unitCount} units`, `${item.unitCount} 个单元`) : l("No units", "无单元")} · {l(`${item.wordCount} words`, `${item.wordCount} 个词`)} · v{item.version}</p>
        <p className="faint mt-4">{l(`By ${item.authorName} · ${item.cloneCount} clones`, `作者 ${item.authorName} · 已克隆 ${item.cloneCount}`)}</p>
        <div className="row mt-16"><button className="btn btn-primary btn-sm" disabled={busy === item.id} onClick={() => void clone(item)}>{busy === item.id ? l("Cloning…", "克隆中…") : l("Clone for free", "免费克隆")}</button>
          <button className="btn btn-sm" onClick={() => void report(item)}>{l("Report", "举报")}</button></div>
      </article>)}</div>}
  </div>;
}

export function mountCourseMarket(element: HTMLElement, options: Parameters<typeof CourseMarket>[0] = {}) {
  const root = createRoot(element); root.render(<CourseMarket {...options} />); return () => root.unmount();
}
