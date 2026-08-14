import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type {
  ExamAnswerInput,
  GeneratedExamAttempt,
  GeneratedExamNoteDetail,
  GeneratedExamQuestionV1,
  GeneratedKnowledgeGraphV1,
  GeneratedNoteDetail,
  GeneratedNoteSummary,
  KnowledgeNodeQuestion,
} from "@nalanda/types";
import { DB } from "../../legacy/data";
import { supabase } from "../../lib/supabase";
import { ApiClientError } from "../../lib/api";
import { materialsAiApi } from "./api";
import { materialAiErrorText } from "./errorText";
import { clearOtherAccounts, deleteDraft, draftKey, loadDraft, saveDraft } from "./examDraftStore";

interface Course { id: string; name: string; code: string | null }
interface Props {
  userId: string;
  initialNoteId?: string;
  onOpenReal: (id: string) => void;
  onOpenDemo: (id: string) => void;
  onBack: () => void;
  onMaterials: () => void;
  toast: (message: string, icon?: string) => void;
}

const gradient = "linear-gradient(135deg,#a97142,#d2a675)";
const english = (englishText: string, _chineseText: string) => englishText;
const formatEnglishDateTime = (value: string) => new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium", timeStyle: "short",
}).format(new Date(value));
const KnowledgeGraphCanvas = lazy(() => import("./KnowledgeGraphCanvas"));

export function NotesView(props: Props) {
  const l = english;
  const [notes, setNotes] = useState<GeneratedNoteSummary[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [realNotes, courseResult] = await Promise.all([
        materialsAiApi.notes(),
        supabase!.from("courses").select("id,name,code").order("created_at", { ascending: true }),
      ]);
      if (courseResult.error) throw courseResult.error;
      setNotes(realNotes); setCourses((courseResult.data || []) as Course[]);
    } catch (failure) { setError(materialAiErrorText(failure, l("My Notes could not be loaded.", "My Notes 加载失败。"), l)); }
    finally { setLoading(false); }
  }, [l]);

  useEffect(() => { void clearOtherAccounts(props.userId); void load(); }, [load, props.userId]);

  if (props.initialNoteId) return <RealNote noteId={props.initialNoteId} userId={props.userId} onBack={props.onBack} toast={props.toast} />;
  const visible = filter === "all" ? notes : notes.filter((note) => note.courseId === filter || filter === "unfiled" && !note.courseId);
  const demoNotes = filter === "all" || filter === "demo" ? DB.notes : [];
  return <div className="wrap">
    <div className="page-head">
      <div><div className="eyebrow">{l("Personal library", "个人资料库")}</div><h1 className="page-title">My Notes</h1>
        <p className="page-sub">{l(`${notes.length} private AI results plus ${DB.notes.length} clearly labelled demos.`, `${notes.length} 份私有 AI 结果，另有 ${DB.notes.length} 份明确标注的演示内容。`)}</p></div>
      <button className="btn btn-primary" onClick={props.onMaterials}><span aria-hidden>✦</span><span>{l("Generate from Materials", "从 Materials 生成")}</span></button>
    </div>
    <div className="row gap-8 wrap-flex" style={{ marginBottom: 22 }}>
      <button className={`chip ${filter === "all" ? "chip-accent" : "chip-outline"}`} onClick={() => setFilter("all")}>{l("All", "全部")}</button>
      {courses.map((course) => <button key={course.id} className={`chip ${filter === course.id ? "chip-accent" : "chip-outline"}`} onClick={() => setFilter(course.id)}>{course.code || course.name}</button>)}
      <button className={`chip ${filter === "unfiled" ? "chip-accent" : "chip-outline"}`} onClick={() => setFilter("unfiled")}>{l("Unfiled", "未归档")}</button>
      <button className={`chip ${filter === "demo" ? "chip-accent" : "chip-outline"}`} onClick={() => setFilter("demo")}>{l("Demo", "演示")}</button>
    </div>
    {error && <div className="course-feedback wrong" role="alert">{error}<button className="btn btn-sm" onClick={() => void load()}>{l("Retry", "重试")}</button></div>}
    {loading ? <div className="card card-pad muted">{l("Loading…", "加载中…")}</div> : <>
      {(filter !== "demo") && <section>
        <div className="sec-h" style={{ marginTop: 0 }}><h2 className="serif">{l("Your generated notes", "你的生成笔记")}</h2><span className="chip chip-accent">{l("Private", "私有")}</span></div>
        {visible.length ? <div className="grid g-3">{visible.map((note) => <RealNoteCard key={note.id} note={note} onOpen={() => props.onOpenReal(note.id)} />)}</div>
          : <div className="card card-pad center muted">{l("No generated AI notes in this group yet.", "此分组还没有 AI 笔记。")}</div>}
      </section>}
      {demoNotes.length > 0 && <section>
        <div className="sec-h"><h2 className="serif">{l("Demo", "演示")}</h2><span className="chip chip-outline">{l("Sample data — not your files", "演示数据，并非你的文件")}</span></div>
        <div className="grid g-3">{demoNotes.map((note: any) => <button key={note.id} className="card ncard hoverable material-ai-note-button" onClick={() => props.onOpenDemo(note.id)}>
          <div className="ncard-top" style={{ background: note.grad }}><span className="chip material-ai-demo-chip">{l("Demo", "演示")}</span></div>
          <div className="ncard-body"><div className="chip chip-tag">{note.kind}</div><h3 className="serif">{note.title}</h3><p className="muted">{note.desc}</p>
            <div className="ncard-foot"><span className="meta">{note.updated}</span><span className="chip chip-outline">{l("Open", "打开")} ›</span></div></div>
        </button>)}</div>
      </section>}
    </>}
  </div>;
}

function RealNoteCard({ note, onOpen }: { note: GeneratedNoteSummary; onOpen: () => void }) {
  const l = english;
  return <button className="card ncard hoverable material-ai-note-button" onClick={onOpen}>
    <div className="ncard-top" style={{ background: gradient }}><span className="chip material-ai-demo-chip">{note.courseCode || note.courseName}</span></div>
    <div className="ncard-body"><div className="chip chip-accent">{note.kind === "ai_knowledge_graph" ? "AI knowledge map" : l("AI test paper", "AI 试卷")}</div><h3 className="serif">{note.title}</h3>
      <p className="muted">{note.kind === "ai_knowledge_graph" ? `${note.nodeCount} knowledge points · ${note.edgeCount} relationships` : `${note.questionCount} ${l("questions", "题")} · ${note.totalMarks} ${l("marks", "分")}`} · {note.sourceDeleted ? l("Source deleted", "源资料已删除") : note.materialName}</p>
      <div className="ncard-foot"><span className="meta">{formatEnglishDateTime(note.updatedAt)}</span><span className="chip chip-outline">{l("Open", "打开")} ›</span></div>
    </div>
  </button>;
}

function RealNote({ noteId, userId, onBack, toast }: { noteId: string; userId: string; onBack: () => void; toast: Props["toast"] }) {
  const l = english;
  const [note, setNote] = useState<GeneratedNoteDetail | null>(null);
  const [attempts, setAttempts] = useState<GeneratedExamAttempt[]>([]);
  const [active, setActive] = useState<GeneratedExamAttempt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const detail = await materialsAiApi.note(noteId);
      const history = detail.kind === "ai_exam" ? await materialsAiApi.attempts(noteId) : [];
      setNote(detail); setAttempts(history); setError("");
    } catch (failure) { setError(materialAiErrorText(failure, l("The note could not be loaded.", "笔记加载失败。"), l)); }
  }, [l, noteId]);
  useEffect(() => { void load(); }, [load]);

  if (active && note?.kind === "ai_exam") return <ExamSession userId={userId} note={note} initial={active} onExit={() => { setActive(null); void load(); }} toast={toast} />;
  if (!note) return <div className="wrap"><button className="btn btn-ghost btn-sm" onClick={onBack}>‹ My Notes</button>{error ? <div className="course-feedback wrong">{error}</div> : <div className="card card-pad muted">{l("Loading…", "加载中…")}</div>}</div>;
  const start = async () => {
    setBusy(true);
    try { setActive(await materialsAiApi.createAttempt(note.id)); }
    catch (failure) { toast(materialAiErrorText(failure, l("The exam could not be started.", "无法开始考试。"), l)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm(l("Delete this generated note and every saved attempt?", "删除此生成笔记及全部答卷？"))) return;
    setBusy(true);
    try { await materialsAiApi.deleteNote(note.id); onBack(); }
    catch (failure) { toast(materialAiErrorText(failure, l("Delete failed.", "删除失败。"), l)); }
    finally { setBusy(false); }
  };
  if (note.kind === "ai_knowledge_graph") {
    return <div className="wrap wrap-wide">
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 18 }}>‹ My Notes</button>
      <div className="page-head"><div><div className="row gap-8"><span className="chip chip-accent">✦ AI-generated</span><span className="chip chip-tag">{note.courseName}</span></div>
        <h1 className="page-title serif">{note.title}</h1><p className="meta mt-8">From <b>{note.materialName}</b> · {note.sourceDeleted ? "source deleted" : "private source"}</p></div>
        <button className="btn" disabled={busy} onClick={() => void remove()}>Delete</button>
      </div>
      <KnowledgeGraphView noteId={note.id} graph={note.graph} toast={toast} />
    </div>;
  }
  return <div className="wrap">
    <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 18 }}>‹ My Notes</button>
    <div className="page-head"><div><div className="row gap-8"><span className="chip chip-accent">✦ {l("AI-generated", "AI 生成")}</span><span className="chip chip-tag">{note.courseName}</span></div>
      <h1 className="page-title serif">{note.title}</h1><p className="meta mt-8">{l("From", "来源")} <b>{note.materialName}</b> · {note.sourceDeleted ? l("source deleted", "源资料已删除") : l("private source", "私有源资料")}</p></div>
      <div className="row gap-8"><button className="btn" disabled={busy} onClick={() => void remove()}>{l("Delete", "删除")}</button><button className="btn btn-primary" disabled={busy} onClick={() => void start()}>{busy ? l("Starting…", "启动中…") : l("Start timed attempt", "开始限时考试")}</button></div>
    </div>
    <div className="grid material-ai-note-layout">
      <div className="exam-paper"><div className="exam-head"><div className="eyebrow">Nalanda · {l("Generated paper", "生成试卷")}</div><h2 className="serif">{note.exam.title}</h2><p className="faint">{note.exam.durationMinutes} min · {note.exam.totalMarks} {l("marks", "分")} · {note.exam.difficulty}</p></div>
        {note.exam.sections.map((section) => <div className="exam-sec" key={section.id}><div className="exam-sec-h">{section.title}</div>{section.questions.map((question, index) => <div className="exam-q" key={question.id}><b>{index + 1}.</b><span>{question.prompt} <span className="faint">[{question.marks}]</span></span></div>)}</div>)}
      </div>
      <aside className="card card-pad material-ai-sticky"><div className="eyebrow">{l("Attempt history", "考试记录")}</div>
        {attempts.length ? attempts.map((attempt, index) => <button className="list-row material-ai-history" key={attempt.id} onClick={() => setActive(attempt)}>
          <span>#{attempts.length - index}</span><span className="fill">{attemptStatus(attempt.status, l)}</span><b>{attempt.totalScore == null ? "—" : `${attempt.totalScore}/${attempt.totalMarks}`}</b>
        </button>) : <p className="muted">{l("No attempts yet.", "暂无答卷。")}</p>}
      </aside>
    </div>
  </div>;
}

function KnowledgeGraphView({ noteId, graph, toast }: {
  noteId: string;
  graph: GeneratedKnowledgeGraphV1;
  toast: Props["toast"];
}) {
  const ordered = [...graph.nodes].sort((a, b) => a.sourceOrder - b.sourceOrder || a.id.localeCompare(b.id));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [questionJob, setQuestionJob] = useState<KnowledgeNodeQuestion | null>(null);
  const [asking, setAsking] = useState(false);
  const selected = ordered.find((node) => node.id === selectedId) || null;

  useEffect(() => {
    if (!questionJob || !["queued", "processing"].includes(questionJob.status)) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void materialsAiApi.knowledgeQuestion(questionJob.id).then((next) => {
        if (!cancelled) setQuestionJob(next);
      }).catch((failure) => {
        if (!cancelled) toast(materialAiErrorText(failure, "The knowledge answer could not be refreshed.", english));
      });
    }, document.hidden ? 10000 : 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [questionJob, toast]);

  const ask = async () => {
    if (!selected || pinnedId !== selected.id || !question.trim() || asking) return;
    setAsking(true); setQuestionJob(null);
    try {
      const job = await materialsAiApi.askKnowledgeNode(noteId, selected.id, {
        idempotencyKey: crypto.randomUUID(), question: question.trim(),
      });
      setQuestionJob(job);
    } catch (failure) {
      toast(materialAiErrorText(failure, "The question could not be queued.", english));
    } finally { setAsking(false); }
  };

  if (!ordered.length) return <div className="card card-pad muted">This knowledge map has no renderable points.</div>;
  return <>
    <div className="card card-pad material-knowledge-intro"><div className="eyebrow">Knowledge map overview</div><p>{graph.overview}</p>
      {!!graph.learningObjectives.length && <div className="row gap-8 wrap-flex">{graph.learningObjectives.map((item, index) => <span className="chip chip-outline" key={index}>{item}</span>)}</div>}
    </div>
    <div className="grid material-knowledge-layout">
      <Suspense fallback={<div className="card material-flow-loading">Preparing the interactive map…</div>}>
        <KnowledgeGraphCanvas noteId={noteId} graph={graph} pinnedId={pinnedId} toast={toast} onInspect={(nodeId, pinned) => {
          if (nodeId !== selectedId) setQuestionJob(null);
          setSelectedId(nodeId); setPinnedId(pinned && nodeId ? nodeId : null);
        }} />
      </Suspense>
      <aside className="card card-pad material-ai-sticky material-knowledge-detail" aria-live="polite">
        {!selected ? <div className="material-knowledge-placeholder"><div className="eyebrow">Knowledge point details</div><p className="muted">Hover or focus a node to preview it. Click a node to keep its details open and ask a question.</p></div> : <>
          <div className="row between gap-8"><span className="chip chip-accent">Point {ordered.indexOf(selected) + 1}</span><span className="chip chip-tag">Level {selected.level}</span></div>
          <h2 className="serif">{selected.title}</h2><p>{selected.explanation}</p>
          <KnowledgeNodeList title="Key details" values={selected.keyDetails} />
          <KnowledgeNodeList title="Examples" values={selected.examples} />
          <KnowledgeNodeList title="Formulas" values={selected.formulas} />
          <KnowledgeNodeList title="Common misconceptions" values={selected.commonMisconceptions} />
          <KnowledgeNodeList title="Check yourself" values={selected.checkQuestions} />
          {pinnedId === selected.id ? <><div className="divider" />
            <div className="eyebrow">Ask about this knowledge point</div>
            <p className="muted" style={{ fontSize: 12 }}>Each successful answer uses one daily free AI generation. Your question cannot change the model, tools, or safety rules.</p>
            <textarea className="search material-ai-answer" maxLength={2000} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask a specific question…" />
            <button className="btn btn-primary" disabled={asking || !question.trim()} style={{ width: "100%", marginTop: 8 }} onClick={() => void ask()}>{asking ? "Queuing…" : "Ask this point"}</button>
            {questionJob && <div className={`course-feedback ${questionJob.status === "failed" ? "wrong" : ""}`} style={{ marginTop: 12 }}>
              {questionJob.status === "succeeded" && questionJob.answer ? <><b>Answer</b><p>{questionJob.answer.answer}</p>
                <KnowledgeNodeList title="Key points" values={questionJob.answer.keyPoints} />
                <KnowledgeNodeList title="Follow-up questions" values={questionJob.answer.followUpQuestions} /></>
                : questionJob.status === "failed" ? `${questionJob.errorCode || "AI_QUESTION_FAILED"} · ${questionJob.errorMessage || "The answer could not be generated."}`
                  : "Preparing a grounded answer…"}
            </div>}</> : <p className="muted" style={{ fontSize: 12 }}>Click this node to keep it open and ask a question.</p>}
          <div className="material-knowledge-sources"><div className="eyebrow">Sources</div>{selected.sourceRefs.map((ref, index) => <span className="chip chip-outline" key={`${ref.blockId}-${ref.locatorKind}-${ref.locatorIndex}-${index}`}>{ref.label || ref.blockId || "Source file"}</span>)}</div>
        </>}
      </aside>
    </div>
  </>;
}

function KnowledgeNodeList({ title, values }: { title: string; values: string[] }) {
  if (!values.length) return null;
  return <section className="material-knowledge-list"><b>{title}</b><ul>{values.map((value, index) => <li key={index}>{value}</li>)}</ul></section>;
}

function attemptStatus(status: GeneratedExamAttempt["status"], l: (english: string, chinese: string) => string) {
  return ({
    in_progress: l("In progress", "进行中"),
    submitted_ungraded: l("Waiting for grading allowance", "等待评分额度"),
    grading: l("Grading", "评分中"),
    completed: l("Completed", "已完成"),
  })[status];
}

function questionType(type: GeneratedExamQuestionV1["type"], l: (english: string, chinese: string) => string) {
  return ({
    single_choice: l("Single choice", "单选题"),
    multiple_choice: l("Multiple choice", "多选题"),
    true_false: l("True / false", "判断题"),
    fill_blank: l("Fill in the blank", "填空题"),
    short_answer: l("Short answer", "简答题"),
    essay: l("Essay", "论述题"),
  })[type];
}

function ExamSession({ userId, note, initial, onExit, toast }: {
  userId: string; note: GeneratedExamNoteDetail; initial: GeneratedExamAttempt; onExit: () => void; toast: Props["toast"];
}) {
  const l = english;
  const [attempt, setAttempt] = useState(initial);
  const [answers, setAnswers] = useState<Record<string, ExamAnswerInput["value"]>>(() => Object.fromEntries(initial.answers.map((answer) => [answer.questionId, answer.value])));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [submitConfirmOpen, setSubmitConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const attemptRef = useRef(attempt); const answersRef = useRef(answers); const dirtyRef = useRef(dirty); const savingRef = useRef<Promise<boolean> | null>(null);
  useEffect(() => { attemptRef.current = attempt; }, [attempt]);
  useEffect(() => { answersRef.current = answers; }, [answers]);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  useEffect(() => {
    let alive = true;
    void loadDraft(userId, initial.id).then((draft) => {
      if (!alive || !draft || draft.revision < initial.revision) return;
      setAnswers((current) => ({ ...current, ...Object.fromEntries(draft.answers.map((answer) => [answer.questionId, answer.value])) }));
      dirtyRef.current = true; setDirty(true);
    });
    return () => { alive = false; };
  }, [initial.id, initial.revision, userId]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const asList = useCallback((): ExamAnswerInput[] => Object.entries(answersRef.current).map(([questionId, value]) => ({ questionId, value })), []);
  const persistLocal = useCallback(() => saveDraft({ key: draftKey(userId, attemptRef.current.id), userId, attemptId: attemptRef.current.id,
    revision: attemptRef.current.revision, answers: asList(), updatedAt: new Date().toISOString() }), [asList, userId]);

  const saveNow = useCallback(async () => {
    if (!dirtyRef.current || attemptRef.current.status !== "in_progress") return true;
    if (savingRef.current) return savingRef.current;
    const snapshot = JSON.stringify(asList());
    const work = (async () => {
      setSaving(true); setSaveError(""); await persistLocal();
      try {
        const updated = await materialsAiApi.saveAnswers(attemptRef.current.id, {
          operationId: crypto.randomUUID(), expectedRevision: attemptRef.current.revision, answers: JSON.parse(snapshot),
        });
        setAttempt(updated); attemptRef.current = updated;
        if (updated.status !== "in_progress") {
          setAnswers(Object.fromEntries(updated.answers.map((answer) => [answer.questionId, answer.value])));
          dirtyRef.current = false; setDirty(false); await deleteDraft(userId, updated.id);
          toast(l(
            "The deadline passed. Only answers synchronized before the deadline were submitted.",
            "考试已截止，仅截止前同步到服务器的答案已提交。",
          ));
          return true;
        }
        if (snapshot === JSON.stringify(asList())) { dirtyRef.current = false; setDirty(false); await deleteDraft(userId, updated.id); }
        return true;
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.code === "EXAM_REVISION_CONFLICT") {
          const latest = await materialsAiApi.attempt(attemptRef.current.id);
          setAttempt(latest); setAnswers(Object.fromEntries(latest.answers.map((answer) => [answer.questionId, answer.value]))); dirtyRef.current = false; setDirty(false);
          await deleteDraft(userId, latest.id); toast(l("This attempt changed on another device. The server version was restored.", "此答卷已在其他设备修改，现已恢复服务器版本。"));
        } else {
          setSaveError(l("Saved on this device; waiting for the network.", "已保存到此设备，等待网络恢复。"));
        }
        return false;
      } finally { setSaving(false); savingRef.current = null; }
    })();
    savingRef.current = work;
    return work;
  }, [asList, l, persistLocal, toast, userId]);

  useEffect(() => {
    if (!dirty) return;
    void persistLocal();
    const timer = setTimeout(() => void saveNow(), 500);
    return () => clearTimeout(timer);
  }, [answers, dirty, persistLocal, saveNow]);

  useEffect(() => {
    const retry = () => { if (dirtyRef.current) void saveNow(); };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [saveNow]);

  useEffect(() => {
    if (attempt.status !== "grading") return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try { const next = await materialsAiApi.attempt(attempt.id); if (!cancelled) setAttempt(next); }
      finally { if (!cancelled && attemptRef.current.status === "grading") timer = setTimeout(poll, document.hidden ? 10000 : 2000); }
    };
    timer = setTimeout(poll, 2000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [attempt.id, attempt.status]);

  const update = (questionId: string, value: ExamAnswerInput["value"]) => {
    setAnswers((current) => ({ ...current, [questionId]: value })); dirtyRef.current = true; setDirty(true);
  };
  const prepareSubmit = async () => {
    if (!await saveNow()) {
      toast(l("Your latest answers are still only on this device. Reconnect before submitting.", "最新答案仍只保存在此设备，请联网同步后再提交。"));
      return;
    }
    if (attemptRef.current.status !== "in_progress") { setAttempt(await materialsAiApi.attempt(attemptRef.current.id)); return; }
    setSubmitConfirmOpen(true);
  };
  const confirmSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const next = await materialsAiApi.submit(attemptRef.current.id, { operationId: crypto.randomUUID(), expectedRevision: attemptRef.current.revision });
      setAttempt(next); dirtyRef.current = false; setDirty(false); setSubmitConfirmOpen(false); await deleteDraft(userId, next.id);
    } catch (failure) { toast(materialAiErrorText(failure, l("Submission failed.", "提交失败。"), l)); }
    finally { setSubmitting(false); }
  };
  const retryGrade = async () => {
    try { setAttempt(await materialsAiApi.requestGrading(attempt.id, { operationId: crypto.randomUUID(), expectedRevision: attempt.revision })); }
    catch (failure) { toast(materialAiErrorText(failure, l("Grading could not be queued.", "无法加入评分队列。"), l)); }
  };

  useEffect(() => {
    if (attempt.status !== "in_progress" || now < new Date(attempt.deadlineAt).getTime()) return;
    let cancelled = false;
    void materialsAiApi.attempt(attempt.id).then((next) => {
      if (!cancelled) {
        setAttempt(next); attemptRef.current = next;
        if (next.status !== "in_progress") {
          setAnswers(Object.fromEntries(next.answers.map((answer) => [answer.questionId, answer.value])));
          dirtyRef.current = false; setDirty(false); void deleteDraft(userId, next.id);
        }
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [attempt.deadlineAt, attempt.id, attempt.status, now, userId]);

  const seconds = Math.max(0, Math.ceil((new Date(attempt.deadlineAt).getTime() - now) / 1000));
  const questions = attempt.exam.sections.flatMap((section) => section.questions);
  const resultMap = new Map(attempt.results.map((result) => [result.questionId, result]));
  const fullMap = new Map(note.exam.sections.flatMap((section) => section.questions).map((question) => [question.id, question]));
  return <div className="wrap wrap-wide">
    <div className="page-head"><div><div className="eyebrow">{l("Online exam", "在线考试")}</div><h1 className="page-title serif">{attempt.exam.title}</h1>
      <p className="page-sub">{attempt.status === "in_progress" ? l("Leaving this page does not pause the timer.", "离开页面不会暂停计时。") : l("This attempt has been submitted.", "本次答卷已提交。")}</p></div>
      <div className="row gap-8"><span className={`chip ${seconds < 300 ? "course-feedback wrong" : "chip-accent"}`}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}</span><button className="btn" onClick={async () => { await saveNow(); onExit(); }}>{l("Save and exit", "保存并退出")}</button></div>
    </div>
    {(saving || saveError) && <div className={`course-feedback ${saveError ? "wrong" : ""}`}>{saving ? l("Saving…", "保存中…") : saveError}</div>}
    {attempt.status !== "in_progress" && <div className="card card-pad" style={{ marginBottom: 18 }}><div className="row between wrap-flex gap-12"><div><b>{l("Result", "成绩")}</b><div className="muted">{attempt.status === "grading" ? l("Subjective answers are being graded.", "主观题正在评分。") : attempt.status === "submitted_ungraded" ? l("Objective subtotal is ready; daily AI grading allowance is unavailable.", "客观题小计已生成；今日 AI 评分额度不足。") : l("Grading completed.", "评分已完成。")}</div></div>
      <div className="stat-n">{attempt.totalScore ?? attempt.objectiveScore} / {attempt.totalMarks}</div>{attempt.status === "submitted_ungraded" && <button className="btn" onClick={() => void retryGrade()}>{l("Request grading", "请求评分")}</button>}</div></div>}
    <div className="grid material-ai-exam-layout"><main>{questions.map((question, index) => <ExamQuestion key={question.id} index={index} question={question as GeneratedExamQuestionV1} value={answers[question.id] ?? null} disabled={attempt.status !== "in_progress"} onChange={(value) => update(question.id, value)} onBlur={() => void saveNow()}
      result={resultMap.get(question.id)} full={fullMap.get(question.id)} />)}</main>
      <aside className="card card-pad material-ai-sticky"><div className="eyebrow">{l("Progress", "进度")}</div><div className="stat-n">{Object.values(answers).filter((value) => value !== null && value !== "" && (!Array.isArray(value) || value.length)).length}/{questions.length}</div>
        <p className="muted" style={{ fontSize: 12.5 }}>{l("Answers auto-save after 500 ms and on blur. An offline draft stays isolated to this account.", "答案会在 500ms 后及失焦时自动保存；离线草稿按账号隔离。")}</p>
        {attempt.status === "in_progress" && <button className="btn btn-primary mt-16" style={{ width: "100%" }} onClick={() => void prepareSubmit()}>{l("Submit paper", "提交试卷")}</button>}
      </aside></div>
    {submitConfirmOpen && <div className="scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !submitting) setSubmitConfirmOpen(false); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="material-exam-submit-title">
        <div className="modal-pad"><div className="eyebrow">Final submission</div><h2 className="serif" id="material-exam-submit-title">Submit the entire paper?</h2>
          <p className="muted">Your answers will be locked. Nalanda grades all objective questions together and then sends all subjective answers in one grading request. Answers and explanations appear only after submission.</p>
          <div className="row gap-8" style={{ justifyContent: "flex-end", marginTop: 18 }}>
            <button className="btn" type="button" disabled={submitting} onClick={() => setSubmitConfirmOpen(false)}>Keep working</button>
            <button className="btn btn-primary" type="button" disabled={submitting} onClick={() => void confirmSubmit()}>{submitting ? "Submitting…" : "Submit paper"}</button>
          </div>
        </div>
      </div>
    </div>}
  </div>;
}

function ExamQuestion({ question, index, value, disabled, onChange, onBlur, result, full }: {
  question: GeneratedExamQuestionV1; index: number; value: ExamAnswerInput["value"]; disabled: boolean;
  onChange: (value: ExamAnswerInput["value"]) => void; onBlur: () => void;
  result?: GeneratedExamAttempt["results"][number]; full?: GeneratedExamQuestionV1;
}) {
  const l = english;
  const toggleMultiple = (optionIndex: number) => {
    const current = Array.isArray(value) ? value.map(Number) : [];
    onChange(current.includes(optionIndex) ? current.filter((item) => item !== optionIndex) : [...current, optionIndex].sort((a, b) => a - b));
  };
  return <div className="quiz-q material-ai-question">
    <div className="row between gap-8"><div className="row gap-8"><span className="knum">{index + 1}</span><span className="chip chip-tag">{questionType(question.type, l)}</span></div><b>{question.marks} {l("marks", "分")}</b></div>
    <h3 className="serif">{question.prompt}</h3>
    {(question.type === "single_choice" || question.type === "multiple_choice") && question.options.map((option, optionIndex) => {
      const chosen = question.type === "multiple_choice" ? Array.isArray(value) && value.map(Number).includes(optionIndex) : Number(value) === optionIndex;
      return <label className={`opt ${chosen ? "material-ai-selected" : ""}`} key={optionIndex}><input type={question.type === "multiple_choice" ? "checkbox" : "radio"} checked={chosen} disabled={disabled}
        onChange={() => question.type === "multiple_choice" ? toggleMultiple(optionIndex) : onChange(optionIndex)} onBlur={onBlur} /> <span>{option}</span></label>;
    })}
    {question.type === "true_false" && <div className="row gap-8">{[true, false].map((choice) => <label className={`opt fill ${value === choice ? "material-ai-selected" : ""}`} key={String(choice)}><input type="radio" checked={value === choice} disabled={disabled} onChange={() => onChange(choice)} onBlur={onBlur} />{choice ? l("True", "正确") : l("False", "错误")}</label>)}</div>}
    {!["single_choice", "multiple_choice", "true_false"].includes(question.type) && <textarea className="search material-ai-answer" value={typeof value === "string" ? value : ""} disabled={disabled} onChange={(event) => onChange(event.target.value)} onBlur={onBlur} placeholder={l("Type your answer…", "输入答案…")} />}
    {result && <div className={`course-feedback ${result.correct === false ? "wrong" : ""}`}><b>{result.awardedMarks ?? 0}/{question.marks}</b> · {result.feedback || l("Awaiting AI grading", "等待 AI 评分")}
      {full && <details><summary>{l("Answer and explanation", "答案与解析")}</summary><p>{full.modelAnswer}</p><p className="muted">{full.explanation}</p></details>}</div>}
  </div>;
}
