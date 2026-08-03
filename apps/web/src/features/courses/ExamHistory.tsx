import { useEffect, useState } from "react";
import type { LearningExamHistoryDetail, LearningExamHistorySummary } from "@nalanda/types";
import { formatDateTime, useI18n } from "../../i18n";
import { CourseLocaleButton } from "./CourseLocaleButton";
import { coursesApi } from "./api";

function resultLabel(record: LearningExamHistorySummary, l: (english: string, chinese: string) => string) {
  if (record.status === "in_progress") return l("In progress", "进行中");
  if (record.status === "cancelled") return l("Cancelled", "已取消");
  return record.passed ? l("Passed", "已通过") : l("Not passed · retries completed", "未通过 · 已完成错题修正");
}

export function ExamHistory({ onBack }: { onBack: () => void }) {
  const { l } = useI18n();
  const [records, setRecords] = useState<LearningExamHistorySummary[]>([]);
  const [detail, setDetail] = useState<LearningExamHistoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    coursesApi.examHistory().then((value) => {
      if (active) { setRecords(value); setLoading(false); }
    }).catch((caught) => {
      if (active) {
        setError(caught instanceof Error ? caught.message : l("Could not load exam history.", "考试历史加载失败"));
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [l]);

  const openDetail = async (id: string) => {
    setLoading(true); setError("");
    try { setDetail(await coursesApi.examHistoryDetail(id)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : l("Could not load exam details.", "考试详情加载失败")); }
    setLoading(false);
  };

  if (detail) return <div className="wrap wrap-wide courses-root">
    <div className="page-head"><div><div className="eyebrow">{l("Exam history", "考试历史")}</div>
      <h1 className="page-title">{detail.courseTitle}</h1><p className="page-sub">{detail.unitName || l("Deleted unit", "已删除单元")} · {detail.examKind === "pronunciation" ? l("Pronunciation exam", "读音考试") : l("Spelling exam", "拼写考试")}</p></div>
      <div className="row"><CourseLocaleButton /><button className="btn" onClick={() => setDetail(null)}>{l("Back to history", "返回历史")}</button></div></div>
    <div className="course-exam-history-summary card card-pad">
      <div><span>{l("Result", "结果")}</span><b>{resultLabel(detail, l)}</b></div>
      <div><span>{l("First-round accuracy", "第一轮正确率")}</span><b>{detail.firstRoundAccuracyPercent}% / {detail.requiredPercent}%</b></div>
      <div><span>{l("Words", "单词")}</span><b>{detail.wordCount}</b></div>
      <div><span>{l("Wrong attempts", "错误次数")}</span><b>{detail.wrongCount}</b></div>
      <div><span>{l("Started", "开始时间")}</span><b>{formatDateTime(detail.startedAt)}</b></div>
      <div><span>{l("Completed", "结束时间")}</span><b>{detail.completedAt ? formatDateTime(detail.completedAt) : "—"}</b></div>
    </div>
    <section className="card card-pad mt-16"><h2 className="serif">{l("Words in this exam", "本次考试单词")}</h2>
      <div className="course-exam-history-words mt-12">{detail.words.map((word) => <article key={word.wordId}>
        <div><b>{word.term}</b><small>{word.ipa || l("IPA not available", "音标待补充")}</small></div>
        <div className="course-result-translations">{word.translations.map((translation) => <em key={translation}>{translation}</em>)}</div>
        <span className={`badge ${word.passed ? "badge-success" : ""}`}>{word.passed ? l("Corrected", "已答对") : l("Not corrected", "未答对")}</span>
        <span className="faint">{l(`${word.wrongCount} errors`, `错误 ${word.wrongCount} 次`)}</span>
      </article>)}</div>
    </section>
    <section className="card card-pad mt-16"><h2 className="serif">{l("Attempt details", "答题明细")}</h2>
      {!detail.attempts.length ? <p className="muted mt-12">{l("No submitted attempts.", "没有已提交的答题记录。")}</p>
        : <div className="course-exam-attempts mt-12">{detail.attempts.map((attempt, index) => <article key={attempt.id}>
          <div><b>{index + 1}. {attempt.term || l("Deleted word", "已删除单词")}</b><small>{formatDateTime(attempt.createdAt)}</small></div>
          <span>{attempt.skill === "speech_assessment" ? l("Pronunciation score", "读音评分") : l("Spelling", "拼写")}</span>
          <span className={attempt.correct ? "course-attempt-correct" : "course-attempt-wrong"}>{attempt.correct ? l("Correct", "正确") : l("Wrong", "错误")}</span>
          <span>{attempt.pronunciationScore == null ? attempt.answer || "—" : `${Math.round(attempt.pronunciationScore)} / 100`}</span>
        </article>)}</div>}
    </section>
  </div>;

  return <div className="wrap wrap-wide courses-root">
    <div className="page-head"><div><div className="eyebrow">{l("Courses", "课程")}</div><h1 className="page-title">{l("Exam history", "考试历史")}</h1>
      <p className="page-sub">{l("Review first-round results, retry completion and every submitted answer.", "查看首轮成绩、错题修正完成状态和每次已提交答案。")}</p></div>
      <div className="row"><CourseLocaleButton /><button className="btn" onClick={onBack}>{l("Back to courses", "返回课程")}</button></div></div>
    {error && <div role="alert" className="course-feedback wrong">{error}</div>}
    {loading ? <div className="card card-pad muted">{l("Loading exam history…", "正在加载考试历史…")}</div>
      : !records.length ? <div className="course-empty"><div className="course-empty-icon">✓</div><h2 className="serif">{l("No exam history yet", "还没有考试记录")}</h2></div>
        : <div className="course-exam-history-list">{records.map((record) => <article className="card card-pad" key={record.id}>
          <div className="row between wrap-flex"><div><div className="eyebrow">{record.examKind === "pronunciation" ? l("Pronunciation exam", "读音考试") : l("Spelling exam", "拼写考试")}</div>
            <h2 className="serif">{record.courseTitle} · {record.unitName || l("Deleted unit", "已删除单元")}</h2></div><span className={`badge ${record.passed ? "badge-success" : ""}`}>{resultLabel(record, l)}</span></div>
          <div className="course-exam-history-meta mt-12"><span>{formatDateTime(record.startedAt)}</span><span>{l(`${record.wordCount} words`, `${record.wordCount} 个词`)}</span>
            <span>{l(`First round ${record.firstRoundAccuracyPercent}% / required ${record.requiredPercent}%`, `首轮 ${record.firstRoundAccuracyPercent}% / 要求 ${record.requiredPercent}%`)}</span><span>{l(`${record.wrongCount} wrong attempts`, `错误 ${record.wrongCount} 次`)}</span></div>
          <button className="btn btn-sm mt-16" onClick={() => void openDetail(record.id)}>{l("View details", "查看详情")}</button>
        </article>)}</div>}
  </div>;
}
