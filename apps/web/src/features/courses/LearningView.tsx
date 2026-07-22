import { useEffect, useMemo, useRef, useState } from "react";
import type {
  LearningAttemptResult, LearningCourseDetail, LearningSession, PronunciationAssessment,
  VocabularyWord,
} from "@nalanda/types";
import { authedFetch } from "../../lib/api";
import { coursesApi } from "./api";
import { beginWavRecording } from "./recording";
import { useI18n } from "../../i18n";
import { CourseLocaleButton } from "./CourseLocaleButton";

const STAGES = ["recognition", "pronunciation", "translation", "spelling"] as const;

function queueState(session: LearningSession) {
  const raw = session.state as { queue?: unknown; nextQueue?: unknown; cursor?: unknown; round?: unknown };
  const queue = Array.isArray(raw.queue) ? raw.queue.map(String) : session.items.map((item) => item.word.id);
  const nextQueue = Array.isArray(raw.nextQueue) ? raw.nextQueue.map(String) : [];
  const cursor = Math.max(0, Number(raw.cursor || 0));
  return { queue, nextQueue, cursor, round: Math.max(1, Number(raw.round || 1)) };
}

function fallbackSpeak(text: string) {
  if (!("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text); utterance.lang = "en-US";
  window.speechSynthesis.speak(utterance); return true;
}

function stableShuffle(words: VocabularyWord[], salt: string) {
  const score = (value: string) => [...`${salt}:${value}`].reduce((sum, char) => ((sum * 33) ^ char.charCodeAt(0)) >>> 0, 5381);
  return [...words].sort((left, right) => score(left.id) - score(right.id) || left.id.localeCompare(right.id));
}

async function playWord(word: VocabularyWord, setNotice: (value: string) => void, l: (english: string, chinese: string) => string) {
  try {
    const response = await authedFetch(`/api/pronunciation/audio/${word.id}`);
    if (!response.ok) throw new Error();
    const url = URL.createObjectURL(await response.blob());
    const audio = new Audio(url); audio.onended = () => URL.revokeObjectURL(url); await audio.play();
  } catch {
    if (fallbackSpeak(word.term)) setNotice(l("Azure audio is unavailable, so browser speech is being used.", "Azure 发音暂不可用，已使用浏览器朗读"));
    else setNotice(l("Audio is temporarily unavailable. You can continue learning.", "发音暂不可用，不影响继续学习"));
  }
}

function SpellingDiff({ expected, actual }: { expected: string; actual: string }) {
  const length = Math.max(expected.length, actual.length);
  return <span className="mono">{Array.from({ length }, (_, index) => {
    const char = actual[index] || "□";
    return <span key={index} className={expected[index]?.toLowerCase() === actual[index]?.toLowerCase() ? "" : "course-diff-bad"}>{char}</span>;
  })}</span>;
}

export function LearningView({ sessionId, onExit, onChanged }: {
  sessionId: string;
  onExit: () => void;
  onChanged: () => void;
}) {
  const { l } = useI18n();
  const label = (stage: string) => ({
    recognition: l("Recognition", "认单词"),
    pronunciation: l("Pronunciation", "发音记忆"),
    translation: l("Translation", "翻译记忆"),
    spelling: l("Spelling", "拼写记忆"),
    completed: l("Complete", "完成"),
  } as Record<string, string>)[stage] || stage;
  const [session, setSession] = useState<LearningSession | null>(null);
  const [course, setCourse] = useState<LearningCourseDetail | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [spelling, setSpelling] = useState("");
  const [feedback, setFeedback] = useState<{ result: LearningAttemptResult; skill: "pronunciation" | "translation" | "spelling"; actual?: string } | null>(null);
  const [activeAudioId, setActiveAudioId] = useState("");
  const [recording, setRecording] = useState(false);
  const [assessment, setAssessment] = useState<PronunciationAssessment | null>(null);
  const stopRef = useRef<null | (() => Promise<Blob | null>)>(null);
  const [reviewOffsets, setReviewOffsets] = useState<number[]>([]);

  const load = async () => {
    const next = await coursesApi.session(sessionId);
    setSession(next);
    if (!course || course.id !== next.courseId) setCourse(await coursesApi.detail(next.courseId));
    return next;
  };
  useEffect(() => { let active = true; setError(""); coursesApi.session(sessionId).then(async (next) => {
    const detail = await coursesApi.detail(next.courseId); if (active) { setSession(next); setCourse(detail); }
  }).catch((caught) => active && setError(caught instanceof Error ? caught.message : l("Could not load this session.", "会话加载失败")));
    return () => { active = false; void stopRef.current?.(); };
  }, [sessionId, l]);

  const q = session ? queueState(session) : { queue: [], nextQueue: [], cursor: 0, round: 1 };
  const currentId = q.queue[q.cursor];
  const current = session?.items.find((item) => item.word.id === currentId)?.word || null;
  const batchStart = Math.floor(q.cursor / 5) * 5;
  const batch = session ? q.queue.slice(q.cursor, batchStart + 5)
    .map((id) => session.items.find((item) => item.word.id === id)?.word).filter(Boolean) as VocabularyWord[] : [];
  const audioBatch = session ? stableShuffle(batch, `${session.id}:${session.stage}:${q.round}:${batchStart}:audio`) : [];
  const wordBatch = [...audioBatch].reverse();
  useEffect(() => { setSelected([]); setSpelling(""); setAssessment(null); setActiveAudioId(""); }, [currentId, session?.stage]);

  const translationOptions = useMemo(() => {
    if (!current || !course) return [];
    const all = [...new Set(course.units.flatMap((unit) => unit.words.flatMap((word) => word.translations)))];
    const distractors = all.filter((value) => !current.translations.includes(value)).slice(0, Math.max(3, 6 - current.translations.length));
    const values = [...current.translations, ...distractors];
    return values.sort((a, b) => `${current.id}:${a}`.localeCompare(`${current.id}:${b}`));
  }, [course, current]);

  const refresh = async () => { const next = await load(); onChanged(); return next; };
  const recognize = async () => {
    if (!current || !session) return;
    setBusy(true); setError("");
    try { await coursesApi.recognition(session.id, current.id); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : l("Could not save progress.", "保存进度失败")); }
    setBusy(false);
  };
  const attempt = async (word: VocabularyWord, answer: Record<string, unknown>, actual?: string) => {
    if (!session || feedback || !["pronunciation", "translation", "spelling"].includes(session.stage)) return;
    const skill = session.stage as "pronunciation" | "translation" | "spelling";
    setBusy(true); setError("");
    try {
      const result = await coursesApi.attempt(session.id, { wordId: word.id, skill: session.stage as "pronunciation" | "translation" | "spelling", answer });
      await refresh(); setFeedback({ result, skill, actual });
    } catch (caught) { setError(caught instanceof Error ? caught.message : l("Could not submit the answer.", "答案提交失败")); }
    setBusy(false);
  };

  const assessBlob = async (blob: Blob) => {
    if (!session || !current) return;
    setBusy(true); setNotice("");
    try {
      const form = new FormData(); form.append("sessionId", session.id); form.append("wordId", current.id); form.append("audio", blob, "reading.wav");
      const response = await authedFetch("/api/pronunciation/assess", { method: "POST", body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || l("Pronunciation assessment is temporarily unavailable.", "朗读评分暂不可用"));
      setAssessment(body); await refresh();
    } catch (caught) { setNotice(l(`${caught instanceof Error ? caught.message : "Pronunciation assessment is temporarily unavailable."} You can continue learning.`, `${caught instanceof Error ? caught.message : "朗读评分暂不可用"}，不影响继续学习`)); }
    setBusy(false); setRecording(false); stopRef.current = null;
  };
  const toggleRecording = async () => {
    if (recording && stopRef.current) { const blob = await stopRef.current(); if (blob) await assessBlob(blob); return; }
    try {
      stopRef.current = await beginWavRecording((blob) => { void assessBlob(blob); }); setRecording(true); setNotice(l("Recording… Read the word, then stop (8 seconds maximum).", "正在录音，朗读后点击停止（最多 8 秒）"));
    } catch (caught) { setNotice(l(`${caught instanceof Error ? caught.message : "The microphone is unavailable."} This is not counted as an error.`, `${caught instanceof Error ? caught.message : "麦克风不可用"}，不计入错误次数`)); }
  };

  if (error && !session) return <div className="wrap"><div role="alert" className="card card-pad" style={{ color: "var(--pink)" }}>{error}<div className="mt-12"><button className="btn" onClick={onExit}>{l("Back to courses", "返回课程")}</button></div></div></div>;
  if (!session || !course) return <div className="wrap"><div className="card card-pad muted">{l("Restoring learning progress…", "恢复学习进度中…")}</div></div>;
  if (!session.active && session.stage !== "completed") return <div className="wrap"><div role="status" className="card card-pad">
    <h1 className="page-title">{l("This learning session has ended", "本次学习已结束")}</h1><p className="page-sub">{l("The course content was updated elsewhere. Previous attempts are retained; return to the course to start a new session.", "课程内容已在其它位置更新；旧答题事实仍保留，请返回课程开始新的会话。")}</p>
    <button className="btn btn-primary mt-16" onClick={onExit}>{l("Back to courses", "返回课程")}</button>
  </div></div>;
  if (session.stage === "completed") {
    const unitId = session.unitId;
    if (!unitId) return <div className="wrap"><div role="status" className="card card-pad">
      <h1 className="page-title">{l("Historical session completed", "历史学习已完成")}</h1><p className="page-sub">{l("The original unit was deleted. Attempt history is retained, but reviews can no longer be scheduled for this unit.", "原单元已经删除，历史答题事实仍保留，但不能再为该单元安排复习。")}</p>
      <button className="btn btn-primary mt-16" onClick={onExit}>{l("Back to courses", "返回课程")}</button>
    </div></div>;
    const unit = course.units.find((entry) => entry.id === unitId);
    const saveSchedule = async () => {
      setBusy(true); setError("");
      try { if (reviewOffsets.length) await coursesApi.schedule(unitId, session.id, reviewOffsets); onChanged(); onExit(); }
      catch (caught) { setError(caught instanceof Error ? caught.message : l("Could not save the review schedule.", "复习计划保存失败")); setBusy(false); }
    };
    return <div className="wrap course-session courses-root"><div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}><CourseLocaleButton /></div><div className="card course-study-card">
      <div className="course-empty-icon">✓</div><div className="eyebrow">{l("Session complete", "会话完成")}</div>
      <h1 className="page-title">{session.mode === "initial" ? l(`${unit?.name || "This unit"}: first learning complete`, `${unit?.name || "本单元"} 首次学习完成`) : l("Review complete", "本次复习完成")}</h1>
      <p className="page-sub" style={{ textAlign: "center" }}>{session.mode === "initial" ? l("Mastery still depends on reviews across different dates. You may add separate review schedules; none are selected by default.", "熟练度仍以跨日期复习为准。可选择加入独立复习日程，均默认不勾选。") : l("Words completed in this session gained one review. Each skill counts distinct dates only.", "本次最终完成的词已累计一次复习；各能力只按不同日期计数。")}</p>
      {session.mode === "initial" && <div className="row wrap-flex mt-24">{[3, 7, 15, 30].map((offset) => <label className="chip chip-outline" key={offset}>
        <input type="checkbox" checked={reviewOffsets.includes(offset)} onChange={(event) => setReviewOffsets((values) => event.target.checked ? [...values, offset] : values.filter((value) => value !== offset))} /> {l(`In ${offset} days`, `${offset} 天后`)}
      </label>)}</div>}
      {error && <div role="alert" className="course-feedback wrong">{error}</div>}
      <div className="row mt-24"><button className="btn" onClick={onExit}>{session.mode === "initial" ? l("Not now", "暂不安排") : l("Back to courses", "返回课程")}</button>
        {session.mode === "initial" && <button className="btn btn-primary" disabled={busy} onClick={saveSchedule}>{busy ? l("Saving…", "保存中…") : l("Save and return", "保存并返回")}</button>}</div>
    </div></div>;
  }

  const completedParts = session.items.reduce((sum, item) => sum + Number(item.recognitionSeen) + Number(item.pronunciationPassed) + Number(item.translationPassed) + Number(item.spellingPassed), 0);
  const initialPercent = Math.round(completedParts / Math.max(1, session.items.length * 4) * 100);
  return <div className="wrap course-session courses-root">
    <div className="row between wrap-flex" style={{ marginBottom: 14 }}><div><div className="eyebrow">{course.title} · {l(`Round ${q.round}`, `第 ${q.round} 轮`)}</div>
      <h1 className="page-title">{label(session.stage)}</h1></div><div className="row"><CourseLocaleButton /><button className="btn" onClick={onExit}>{l("Pause and return", "暂停并返回")}</button></div></div>
    <div className="course-stage-track">{STAGES.map((stage) => <div key={stage} className={`course-stage-step ${session.stage === stage ? "active" : ""}`}>{label(stage)}</div>)}</div>
    <div className="row between" style={{ marginBottom: 8 }}><span className="faint">{session.mode === "initial" ? l(`First-learning progress ${initialPercent}%`, `首次学习完成度 ${initialPercent}%`) : l(`${session.selectedSkills.length} review skills`, `复习项目 ${session.selectedSkills.length} 项`)}</span><span className="faint">{l(`Round ${Math.min(q.cursor + 1, q.queue.length)}/${q.queue.length} · Retry pool ${q.nextQueue.length}`, `本轮 ${Math.min(q.cursor + 1, q.queue.length)}/${q.queue.length} · 候补 ${q.nextQueue.length}`)}</span></div>
    <div className="bar" style={{ marginBottom: 16 }}><i style={{ width: `${Math.round(q.cursor / Math.max(1, q.queue.length) * 100)}%` }} /></div>
    {error && <div role="alert" className="course-feedback wrong">{error}</div>}
    {notice && <div role="status" className="course-feedback">{notice}</div>}
    <div className="card course-study-card">
      {!current ? <div>{l("Syncing the next stage…", "正在同步下一阶段…")}</div> : session.stage === "recognition" ? <>
        <div className="course-term">{current.term}</div><div className="course-ipa">{current.ipa || l("IPA not available", "音标待补充")}</div>
        <div className="row mt-16"><button className="btn" onClick={() => playWord(current, setNotice, l)}>🔊 {l("US pronunciation", "美式发音")}</button>
          <button className={`btn ${recording ? "btn-primary" : ""}`} disabled={busy} onClick={toggleRecording}>{recording ? l("■ Stop and assess", "■ 停止并评分") : l("🎙 Pronunciation feedback (optional)", "🎙 朗读评分（可选）")}</button></div>
        <div style={{ fontSize: 18, marginTop: 24 }}>{current.translations.join(" / ")}</div>
        {assessment && <div className="course-feedback"><b>{l(`Pronunciation ${Math.round(assessment.pronunciationScore)}`, `发音 ${Math.round(assessment.pronunciationScore)} 分`)}</b>
          <div className="course-phonemes">{assessment.phonemes.map((entry, index) => <span key={`${entry.phoneme}-${index}`} className={`course-phoneme ${entry.needsPractice ? "bad" : ""}`}>{entry.phoneme} {Math.round(entry.accuracyScore)}</span>)}</div></div>}
        <button className="btn btn-primary btn-lg mt-24" disabled={busy} onClick={recognize}>{busy ? l("Saving…", "保存中…") : l("I recognize it — continue", "认识了，继续")}</button>
      </> : session.stage === "pronunciation" ? <>
        <p className="muted">{l("Play a pronunciation on the left, then choose its word on the right. Each batch contains up to 5 words.", "先点击左侧任一发音，再从右侧选择对应单词。每批最多 5 个。")}</p>
        <div className="course-match"><div>{audioBatch.map((word, index) => <button key={word.id} aria-label={l(`Play ${word.term}`, `播放 ${word.term}`)} className={`btn ${activeAudioId === word.id ? "active" : ""}`}
          onClick={() => { setActiveAudioId(word.id); void playWord(word, setNotice, l); }}>🔊 {l(`Audio ${index + 1}`, `发音 ${index + 1}`)}</button>)}</div>
          <div>{wordBatch.map((word) => <button key={word.id} className="btn" disabled={busy || !activeAudioId}
            onClick={() => { const target = session.items.find((item) => item.word.id === activeAudioId)?.word; if (target) void attempt(target, { wordId: word.id }); }}>{word.term}</button>)}</div></div>
      </> : session.stage === "translation" ? <>
        <div className="course-term" style={{ fontSize: 34 }}>{current.term}</div><div className="course-ipa">{current.ipa || l("IPA not available", "音标待补充")}</div>
        <div className="course-options">{translationOptions.map((option) => <button key={option} className={`course-option ${selected.includes(option) ? "selected" : ""}`}
          onClick={() => setSelected((values) => current.translations.length === 1 ? [option] : values.includes(option) ? values.filter((value) => value !== option) : [...values, option])}>{option}</button>)}</div>
        <button className="btn btn-primary mt-24" disabled={busy || !selected.length} onClick={() => attempt(current, { translations: selected })}>{l("Check answer", "确认答案")}</button>
      </> : <>
        <button className="btn" onClick={() => playWord(current, setNotice, l)}>🔊 {l("Play pronunciation", "播放发音")}</button>
        <input className="course-form-field mt-24" style={{ maxWidth: 420, textAlign: "center", fontSize: 20 }} autoFocus
          aria-label={l("Spelling answer", "拼写答案")} value={spelling} onChange={(event) => setSpelling(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && spelling.trim()) void attempt(current, { text: spelling }, spelling); }} />
        <button className="btn btn-primary mt-16" disabled={busy || !spelling.trim()} onClick={() => attempt(current, { text: spelling }, spelling)}>{l("Submit spelling", "提交拼写")}</button>
      </>}
      {feedback && <div className={`course-feedback ${feedback.result.correct ? "" : "wrong"}`}>
        <div><b>{feedback.result.correct ? l("Correct", "回答正确") : l("Incorrect — added to the next-round retry pool", "回答错误，已加入下一轮候补池")}</b></div>
        {!feedback.result.correct && feedback.skill === "spelling" && typeof feedback.result.expected === "string" && <div className="mt-8">{l("Your answer:", "你的答案：")} <SpellingDiff expected={feedback.result.expected} actual={feedback.actual || ""} /><br />{l("Correct spelling:", "正确拼写：")} <span className="mono">{feedback.result.expected}</span></div>}
        {!feedback.result.correct && feedback.skill !== "spelling" && <div className="mt-8">{l("Correct answer:", "正确答案：")} {Array.isArray(feedback.result.expected) ? feedback.result.expected.join(" / ") : feedback.result.expected}</div>}
        <button className="btn btn-sm mt-12" onClick={() => setFeedback(null)}>{l("Continue", "继续")}</button>
      </div>}
    </div>
  </div>;
}
