import { useCallback, useEffect, useRef, useState } from "react";
import type {
  LearningAudioManifest, LearningCourseDetail, LearningCourseInput, LearningCourseSummary, LearningScope, LearningSkill,
  VocabularyUnitInput,
} from "@nalanda/types";
import { coursesApi } from "./api";
import { CourseEditor } from "./CourseEditor";
import { LearningView } from "./LearningView";
import { CourseLocaleButton } from "./CourseLocaleButton";
import { VocabularyErrorList } from "./VocabularyErrorList";
import { parseMultiUnitVocabularyText, parseVocabularyText, randomCourseId, type VocabularyParseError } from "./parser";
import { useI18n } from "../../i18n";
import {
  cachedAudioCount,
  prefetchAudioAssets,
  removeCachedAudioAssets,
  requestPersistentAudioStorage,
} from "./audioCache";
import "./courses.css";

type WizardStep = "category" | "source" | "setup" | "paste";
type UnitPasteMode = "separate" | "document";
const AUDIO_QUOTA_CODES = new Set([
  "SPEECH_TTS_RATE_LIMIT",
  "SPEECH_TTS_MONTHLY_LIMIT",
  "SPEECH_QUOTA_EXCEEDED",
]);
function quotaPausedAudioCount(manifest: LearningAudioManifest) {
  return manifest.assets.filter(
    (asset) => asset.status === "pending" && AUDIO_QUOTA_CODES.has(asset.lastErrorCode || ""),
  ).length;
}
type PasteUnit = { id: string; name: string; isSystem: boolean; text: string; errors: VocabularyParseError[] };

const CATEGORIES = [
  { id: "english_vocabulary", icon: "Aa", name: ["English vocabulary", "英语单词学习"], description: ["Flashcards, pronunciation, translation, spelling, and review across days", "词卡、发音、翻译、拼写与跨日复习"], enabled: true },
  { id: "knowledge_points", icon: "◇", name: ["Knowledge points", "知识点学习"], description: ["Concepts and knowledge graphs", "适用于概念与知识图谱"], enabled: false },
  { id: "reading_comprehension", icon: "¶", name: ["Reading comprehension", "阅读理解"], description: ["Close reading and comprehension practice", "适用于文章精读与理解训练"], enabled: false },
  { id: "question_bank", icon: "✓", name: ["Question bank", "题库训练"], description: ["Questions and retry loops", "适用于题目与错题循环"], enabled: false },
] as const;

function apiMessage(error: unknown, fallback: string) { return error instanceof Error ? error.message : fallback; }

function Wizard({ onCancel, onReady }: { onCancel: () => void; onReady: (value: LearningCourseInput) => void }) {
  const { l } = useI18n();
  const [step, setStep] = useState<WizardStep>("category");
  const [title, setTitle] = useState("");
  const [hasUnits, setHasUnits] = useState(false);
  const [unitPasteMode, setUnitPasteMode] = useState<UnitPasteMode>("separate");
  const [units, setUnits] = useState<PasteUnit[]>([]);
  const [documentText, setDocumentText] = useState("");
  const [documentErrors, setDocumentErrors] = useState<VocabularyParseError[]>([]);
  const [error, setError] = useState("");

  const beginPaste = () => {
    if (!title.trim()) return setError(l("Enter a course name.", "请填写课程名称"));
    setUnits([{ id: randomCourseId(), name: hasUnits ? "Unit 1" : l("Default unit", "默认单元"), isSystem: !hasUnits, text: "", errors: [] }]);
    setDocumentText(""); setDocumentErrors([]);
    setError(""); setStep("paste");
  };
  const readyWithUnits = (readyUnits: VocabularyUnitInput[]) => {
    const words = readyUnits.flatMap((unit) => unit.words);
    const distinct = new Set(words.map((word) => word.term.trim().replace(/\s+/g, " ").toLowerCase()));
    if (words.length > 2_000 || distinct.size < 4) {
      setError(l("A course must contain 4–2,000 distinct words or phrases.", "整门课程需包含 4–2,000 个不同词或短语"));
      return false;
    }
    setError("");
    onReady({ id: randomCourseId(), title: title.trim(), category: "english_vocabulary", hasUnits, locale: "en-US", units: readyUnits });
    return true;
  };
  const parseAll = (override?: PasteUnit[]) => {
    const source = override || units;
    const parsed = source.map((unit) => ({ unit, result: parseVocabularyText(unit.text) }));
    const next = parsed.map(({ unit, result }) => ({ ...unit, errors: result.errors.length ? result.errors
      : result.nonEmptyLines === 0 ? [{ code: "EMPTY_UNIT", message: "The unit vocabulary list cannot be empty.", line: 1, column: 1, length: 1, source: "" } satisfies VocabularyParseError] : [] }));
    setUnits(next);
    if (next.some((unit) => unit.errors.length)) return setError(l("Fix the highlighted errors first.", "请先修正标红位置"));
    readyWithUnits(parsed.map(({ unit, result }): VocabularyUnitInput => ({ id: unit.id, name: unit.name.trim(), isSystem: unit.isSystem, words: result.words })));
  };
  const parseDocument = (text = documentText) => {
    const result = parseMultiUnitVocabularyText(text);
    setDocumentErrors(result.errors);
    if (result.errors.length) return setError(l("Fix the highlighted errors first.", "请先修正标红位置"));
    readyWithUnits(result.units.map((unit) => ({ ...unit, isSystem: false })));
  };
  const updatePaste = (id: string, text: string, auto = false) => {
    const next = units.map((unit) => unit.id === id ? { ...unit, text, errors: [] } : unit); setUnits(next);
    if (auto && !hasUnits) window.setTimeout(() => {
      const result = parseVocabularyText(text);
      const distinct = new Set(result.words.map((word) => word.term.toLowerCase()));
      if (!result.errors.length && distinct.size >= 4 && result.words.length <= 2_000) parseAll(next);
      else setUnits(next.map((unit) => unit.id === id ? { ...unit, errors: result.errors } : unit));
    }, 0);
  };
  const updateDocument = (text: string, auto = false) => {
    setDocumentText(text); setDocumentErrors([]);
    if (auto) window.setTimeout(() => parseDocument(text), 0);
  };

  return <div className="wrap courses-root"><div className="page-head"><div><div className="eyebrow">{l("Create course", "创建课程")}</div>
    <h1 className="page-title">{l("Create course", "创建课程")}</h1><p className="page-sub">{step === "category" ? l("Each category uses a different learning experience and future AI prompt.", "不同类别将使用不同学习界面和后续 AI prompt。") : l("This release supports manually pasted English vocabulary lists.", "首版只处理手工粘贴的英语词表。")}</p></div>
    <div className="row"><CourseLocaleButton /><button className="btn" onClick={onCancel}>{l("Cancel", "取消")}</button></div></div>
    {step === "category" && <><div className="course-category-grid">{CATEGORIES.map((category) => <button key={category.id} className="course-choice" disabled={!category.enabled}
      onClick={() => setStep("source")}><div className="course-choice-icon">{category.icon}</div><h2 style={{ fontSize: 18 }}>{l(category.name[0], category.name[1])}</h2>
      <p className="muted mt-8">{l(category.description[0], category.description[1])}</p>{!category.enabled && <span className="chip mt-12">{l("Coming soon", "即将推出")}</span>}</button>)}</div></>}
    {step === "source" && <><div className="course-category-grid">
      <button className="course-choice" onClick={() => setStep("setup")}><div className="course-choice-icon">⌨</div><h2 style={{ fontSize: 18 }}>{l("Paste a text vocabulary list", "复制文本词表")}</h2><p className="muted mt-8">{l("Use one word or phrase per line. Put its translation after the last ASCII space and separate multiple translations with /.", "每行一个词/短语，最后一个 ASCII 空格后填写翻译，多个翻译用 / 分隔。")}</p></button>
      <button className="course-choice" disabled><div className="course-choice-icon">⇧</div><h2 style={{ fontSize: 18 }}>{l("Upload a file", "上传文件")}</h2><p className="muted mt-8">{l("PDF, Word, JSON, Markdown, HTML, or image", "PDF、Word、JSON、Markdown、HTML、图片")}</p><span className="chip mt-12">{l("AI parsing coming soon", "AI 解析即将推出")}</span></button>
    </div><button className="btn mt-16" onClick={() => setStep("category")}>{l("Back", "上一步")}</button></>}
    {step === "setup" && <div className="card card-pad">
      <label className="course-label" htmlFor="new-course-title">{l("Course name *", "课程名称 *")}</label><input id="new-course-title" className="course-form-field" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} placeholder={l("Example: Core Academic English", "例如：学术英语核心词汇")} />
      <div className="course-label">{l("Vocabulary structure", "词表结构")}</div><div className="row wrap-flex"><label className="chip chip-outline"><input type="radio" checked={!hasUnits} onChange={() => { setHasUnits(false); setUnitPasteMode("separate"); }} /> {l("No units", "无单元")}</label>
        <label className="chip chip-outline"><input type="radio" checked={hasUnits} onChange={() => setHasUnits(true)} /> {l("Use units", "有单元")}</label></div>
      {hasUnits && <><div className="course-label">{l("How would you like to paste it?", "选择粘贴方式")}</div><div className="row wrap-flex">
        <label className="chip chip-outline"><input type="radio" name="unit-paste-mode" checked={unitPasteMode === "separate"} onChange={() => setUnitPasteMode("separate")} /> {l("One unit at a time", "逐个单元粘贴")}</label>
        <label className="chip chip-outline"><input type="radio" name="unit-paste-mode" checked={unitPasteMode === "document"} onChange={() => setUnitPasteMode("document")} /> {l("One full multi-unit list", "整份多单元词表")}</label>
      </div></>}
      {error && <div role="alert" className="course-feedback wrong">{error}</div>}
      <div className="row mt-24"><button className="btn" onClick={() => setStep("source")}>{l("Back", "上一步")}</button><button className="btn btn-primary" onClick={beginPaste}>{l("Continue", "继续")}</button></div>
    </div>}
    {step === "paste" && hasUnits && unitPasteMode === "document" && <div className="card card-pad"><div><h2 style={{ fontSize: 19 }}>{l("Paste a full multi-unit list", "粘贴整份多单元词表")}</h2>
      <p className="muted mt-4">{l("Use numbered headings such as Starter Unit 1, or wrap any custom unit name in [brackets] or prefix it with #. Put each vocabulary item on the following lines.", "单元标题可使用 Starter Unit 1 这类带序号名称；任意自定义名称可写成 [名称] 或 # 名称，词条写在标题后的各行。")}</p></div>
      <textarea className="course-form-field course-paste course-document-paste mt-12" aria-label={l("Full multi-unit vocabulary list", "整份多单元词表")} value={documentText}
        onChange={(event) => updateDocument(event.target.value)} onPaste={(event) => {
          const pasted = event.clipboardData.getData("text"); if (!pasted) return;
          event.preventDefault(); const target = event.currentTarget; const text = documentText.slice(0, target.selectionStart) + pasted + documentText.slice(target.selectionEnd);
          updateDocument(text, true);
        }} placeholder={'Starter Unit 1\nunit 单元\nsection 部分\nother 另外的/其他的\n\nStarter Unit 2\nbottle 瓶子\nkey 钥匙/关键'} />
      <VocabularyErrorList errors={documentErrors} />
      {error && <div role="alert" className="course-feedback wrong">{error}</div>}
      <div className="row mt-16"><button className="btn" onClick={() => setStep("setup")}>{l("Back", "上一步")}</button><button className="btn btn-primary" onClick={() => parseDocument()}>{l("Parse and edit", "解析并进入编辑")}</button></div>
    </div>}
    {step === "paste" && (!hasUnits || unitPasteMode === "separate") && <><div className="card card-pad"><div className="row between wrap-flex"><div><h2 style={{ fontSize: 19 }}>{l("Paste vocabulary", "粘贴词表")}</h2><p className="muted mt-4">{l("Example:", "示例：")} <code>take part in 参加/参与</code></p></div>
      {hasUnits && units.length < 100 && <button className="btn btn-sm" onClick={() => setUnits((current) => [...current, { id: randomCourseId(), name: `Unit ${current.length + 1}`, isSystem: false, text: "", errors: [] }])}>＋ {l("New unit", "新建单元")}</button>}</div>
      {units.map((unit, index) => <div className="course-editor-unit" key={unit.id}><div className="row between">
        {hasUnits ? <input className="course-form-field" style={{ maxWidth: 330 }} aria-label={l("Unit name", "单元名称")} value={unit.name} onChange={(event) => setUnits((current) => current.map((entry) => entry.id === unit.id ? { ...entry, name: event.target.value } : entry))} /> : <b>{l("Vocabulary", "词表")}</b>}
        {hasUnits && units.length > 1 && <div className="course-icon-actions"><button aria-label={l("Move unit up", "单元上移")} onClick={() => setUnits((current) => { const next = [...current]; if (index > 0) [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>↑</button>
          <button aria-label={l("Move unit down", "单元下移")} onClick={() => setUnits((current) => { const next = [...current]; if (index < next.length - 1) [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })}>↓</button>
          <button aria-label={l("Delete unit", "删除单元")} onClick={() => setUnits((current) => current.filter((entry) => entry.id !== unit.id))}>×</button></div>}</div>
        <textarea className="course-form-field course-paste mt-12" aria-label={l(`${unit.name} vocabulary`, `${unit.name} 词表`)} value={unit.text}
          onChange={(event) => updatePaste(unit.id, event.target.value)} onPaste={(event) => {
            const pasted = event.clipboardData.getData("text"); if (!pasted) return;
            event.preventDefault(); const target = event.currentTarget; const text = unit.text.slice(0, target.selectionStart) + pasted + unit.text.slice(target.selectionEnd);
            updatePaste(unit.id, text, true);
          }} placeholder={'apple 苹果\ntake part in 参加/参与'} />
        <VocabularyErrorList errors={unit.errors} /></div>)}
      {error && <div role="alert" className="course-feedback wrong">{error}</div>}
      <div className="row mt-16"><button className="btn" onClick={() => setStep("setup")}>{l("Back", "上一步")}</button><button className="btn btn-primary" onClick={() => parseAll()}>{l("Parse and edit", "解析并进入编辑")}</button></div>
    </div></>}
  </div>;
}

function CourseCard({ course, countMode, setCountMode, onStart, onReview, onEdit, onRename, onShare, onRevokeShare, onPublish, onDelete }: {
  course: LearningCourseSummary; countMode: boolean; setCountMode: (value: boolean) => void;
  onStart: () => void; onReview: () => void; onEdit: () => void; onRename: () => void; onShare: () => void; onRevokeShare: () => void; onPublish: () => void; onDelete: () => void;
}) {
  const { l } = useI18n();
  return <article className="card hoverable course-card"><div className="row between"><span className="chip chip-accent">{l("English vocabulary", "英语单词")}</span>{course.originAuthorName && <span className="faint" style={{ fontSize: 11 }}>{l(`From ${course.originAuthorName}`, `来自 ${course.originAuthorName}`)}</span>}</div>
    <h2 className="serif mt-12" style={{ fontSize: 20 }}>{course.title}</h2><p className="faint mt-4">{course.hasUnits ? l(`${course.unitCount} units`, `${course.unitCount} 个单元`) : l("No units", "无单元")} · {l(`${course.wordCount} words`, `${course.wordCount} 个词`)}</p>
    <div className="course-card-progress" tabIndex={0} onMouseEnter={() => setCountMode(true)} onMouseLeave={() => setCountMode(false)} onClick={() => setCountMode(!countMode)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setCountMode(!countMode); }}><div className="row between"><b>{countMode ? `${course.learnedCount}/${course.wordCount}` : `${course.progressPercent}%`}</b><span className="faint">{countMode ? l("Learned / total", "已学习/全部") : l("Mastery", "熟练度")}</span></div>
      <div className="bar mt-8"><i style={{ width: `${course.progressPercent}%` }} /></div></div>
    <div className="course-card-actions"><button className="btn btn-primary btn-sm" onClick={onStart}>{course.activeSessionId ? l("Continue learning", "继续学习") : l("Start learning", "开始学习")}</button>
      <button className="btn btn-sm" onClick={onReview}>{l("Review", "复习")}</button><button className="btn btn-sm" onClick={onEdit}>{l("Edit", "编辑")}</button>
      <button className="btn btn-sm" onClick={onRename}>{l("Rename", "改名")}</button><button className="btn btn-sm" onClick={onShare} disabled={!course.canRepublish}>{l("Share", "分享")}</button>
      <button className="btn btn-sm" onClick={onRevokeShare} disabled={!course.canRepublish}>{l("Revoke share", "撤销分享")}</button>
      <button className="btn btn-sm" onClick={onPublish} disabled={!course.canRepublish}>{l("Publish", "上架市场")}</button><button className="btn btn-sm" onClick={onDelete}>{l("Delete", "删除")}</button></div>
  </article>;
}

export function CoursesApp({ toast = () => {}, initialCourseId, initialUnitId, initialScheduleId }: {
  toast?: (message: string, icon?: string) => void;
  initialCourseId?: string; initialUnitId?: string; initialScheduleId?: string;
}) {
  const { l } = useI18n();
  const [courses, setCourses] = useState<LearningCourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wizard, setWizard] = useState(false);
  const [editing, setEditing] = useState<{ course: LearningCourseInput; existing: boolean } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [countModes, setCountModes] = useState<Record<string, boolean>>({});
  const [picker, setPicker] = useState<{ course: LearningCourseDetail; mode: "initial" | "review"; unitId: string; skills: LearningSkill[]; scope: LearningScope; scheduleId?: string } | null>(null);
  const [pickerAudio, setPickerAudio] = useState<{
    manifest: LearningAudioManifest | null;
    running: boolean;
    cached: number;
    persistent: boolean;
  }>({ manifest: null, running: false, cached: 0, persistent: false });
  const pickerDownloadRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => { setLoading(true); try { setCourses(await coursesApi.list()); setError(""); } catch (caught) { setError(apiMessage(caught, l("Could not load courses.", "课程加载失败"))); } setLoading(false); }, [l]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!initialCourseId || !initialUnitId) return;
    coursesApi.detail(initialCourseId).then((course) => setPicker({ course, mode: "review", unitId: initialUnitId,
      skills: ["pronunciation", "translation", "spelling"], scope: "unlearned", scheduleId: initialScheduleId })).catch((caught) => setError(apiMessage(caught, l("Could not open the scheduled review.", "无法打开日程复习"))));
  }, [initialCourseId, initialUnitId, initialScheduleId, l]);

  const openStart = async (summary: LearningCourseSummary) => {
    if (summary.activeSessionId) return setSessionId(summary.activeSessionId);
    try {
      const course = await coursesApi.detail(summary.id);
      if (!course.hasUnits) {
        const session = await coursesApi.startSession(course.id, { unitId: course.units[0].id, mode: "initial", scope: "all", skills: ["pronunciation", "translation", "spelling"] }); setSessionId(session.id);
      } else setPicker({ course, mode: "initial", unitId: course.units[0].id, skills: ["pronunciation", "translation", "spelling"], scope: "all" });
    } catch (caught) { setError(apiMessage(caught, l("Could not start learning.", "无法开始学习"))); }
  };
  const openReview = async (summary: LearningCourseSummary) => {
    try { const course = await coursesApi.detail(summary.id); setPicker({ course, mode: "review", unitId: course.units[0].id,
      skills: ["pronunciation", "translation", "spelling"], scope: "unlearned" }); }
    catch (caught) { setError(apiMessage(caught, l("Could not start review.", "无法开始复习"))); }
  };
  const startPicked = async () => {
    if (!picker || !picker.skills.length) return;
    try { const session = await coursesApi.startSession(picker.course.id, { unitId: picker.unitId, mode: picker.mode,
      skills: picker.skills, scope: picker.mode === "initial" ? "all" : picker.scope, scheduleId: picker.scheduleId }); setPicker(null); setSessionId(session.id); }
    catch (caught) { setError(apiMessage(caught, l("Could not start this session.", "无法开始本次会话"))); }
  };

  useEffect(() => {
    pickerDownloadRef.current?.abort();
    setPickerAudio({ manifest: null, running: false, cached: 0, persistent: false });
    return () => pickerDownloadRef.current?.abort();
  }, [picker?.unitId]);

  const downloadPickedUnit = async () => {
    if (!picker) return;
    if (pickerAudio.running) {
      pickerDownloadRef.current?.abort();
      setPickerAudio((value) => ({ ...value, running: false }));
      return;
    }
    const controller = new AbortController();
    pickerDownloadRef.current = controller;
    const persistent = await requestPersistentAudioStorage();
    setPickerAudio((value) => ({ ...value, running: true, persistent }));
    try {
      let manifest = await coursesApi.prewarmAudio(picker.unitId);
      while (!controller.signal.aborted) {
        await prefetchAudioAssets(
          manifest.assets.filter((asset) => asset.status === "ready"),
          manifest.synthesisVersion,
          2,
        );
        const cached = await cachedAudioCount(manifest.assets, manifest.synthesisVersion);
        const quotaPaused = quotaPausedAudioCount(manifest);
        const activelyPreparing = manifest.pending > quotaPaused;
        setPickerAudio({ manifest, running: activelyPreparing, cached, persistent });
        if (!activelyPreparing) break;
        await new Promise<void>((resolve) => {
          const timer = window.setTimeout(resolve, 3_000);
          controller.signal.addEventListener("abort", () => {
            window.clearTimeout(timer); resolve();
          }, { once: true });
        });
        if (!controller.signal.aborted) manifest = await coursesApi.audioManifest(picker.unitId);
      }
    } catch (caught) {
      setError(apiMessage(caught, l("Could not prepare offline audio.", "无法准备离线音频")));
      setPickerAudio((value) => ({ ...value, running: false }));
    }
  };

  const removePickedAudio = async () => {
    if (!pickerAudio.manifest) return;
    pickerDownloadRef.current?.abort();
    await removeCachedAudioAssets(
      pickerAudio.manifest.assets,
      pickerAudio.manifest.synthesisVersion,
    );
    setPickerAudio((value) => ({ ...value, running: false, cached: 0 }));
  };
  const edit = async (id: string) => {
    try { const detail = await coursesApi.detail(id); setEditing({ existing: true, course: { id: detail.id, title: detail.title,
      category: "english_vocabulary", hasUnits: detail.hasUnits, locale: "en-US", units: detail.units.map((unit) => ({ id: unit.id, name: unit.name,
        isSystem: unit.isSystem, words: unit.words.map((word) => ({ id: word.id, term: word.term, translations: [...word.translations], ipa: word.ipa })) })) } }); }
    catch (caught) { setError(apiMessage(caught, l("Could not open the course editor.", "无法打开课程编辑器"))); }
  };

  if (sessionId) return <LearningView sessionId={sessionId} onExit={() => { setSessionId(null); void load(); }} onChanged={() => void load()} />;
  if (editing) return <CourseEditor initial={editing.course} existing={editing.existing} onCancel={() => setEditing(null)} onSave={async (course) => {
    await coursesApi.save(course, editing.existing); setEditing(null); setWizard(false); toast(l("Course saved", "课程已保存"), "check"); await load();
  }} />;
  if (wizard) return <Wizard onCancel={() => setWizard(false)} onReady={(course) => setEditing({ course, existing: false })} />;

  return <div className="wrap wrap-wide courses-root"><div className="page-head"><div><div className="eyebrow">{l("Courses", "课程")}</div><h1 className="page-title">{l("Learning courses", "学习课程")}</h1>
    <p className="page-sub">{l("Create independent learning courses with progress saved after every step. Subject courses in Materials are unchanged.", "创建独立的学习课程，进度会逐次保存；Materials 中的学科课程不会受影响。")}</p></div><div className="row"><CourseLocaleButton /><button className="btn btn-primary" onClick={() => setWizard(true)}>＋ {l("Create course", "创建课程")}</button></div></div>
    {error && <div role="alert" className="course-feedback wrong" style={{ marginBottom: 16 }}>{error}<button className="btn btn-sm" style={{ marginLeft: 12 }} onClick={() => void load()}>{l("Retry", "重试")}</button></div>}
    {loading ? <div className="card card-pad muted">{l("Loading courses…", "加载课程中…")}</div> : courses.length === 0 ? <div className="course-empty"><div className="course-empty-icon">Aa</div>
      <h2 className="serif" style={{ fontSize: 24 }}>{l("No learning courses yet", "还没有学习课程")}</h2><p className="muted mt-8">{l("Start with an English vocabulary list. Learning, review, and mastery stay recorded here.", "从一份英语词表开始，学习、复习和熟练度会在这里持续记录。")}</p>
      <button className="btn btn-primary mt-24" onClick={() => setWizard(true)}>{l("Create your first course", "创建第一门课程")}</button></div>
      : <div className="course-list">{courses.map((course) => <CourseCard key={course.id} course={course} countMode={Boolean(countModes[course.id])}
        setCountMode={(value) => setCountModes((current) => ({ ...current, [course.id]: value }))} onStart={() => void openStart(course)} onReview={() => void openReview(course)} onEdit={() => void edit(course.id)}
        onRename={async () => { const title = window.prompt(l("New course name", "新的课程名称"), course.title)?.trim(); if (!title || title === course.title) return; try { await coursesApi.rename(course.id, title); toast(l("Course renamed", "课程已改名"), "check"); await load(); } catch (caught) { setError(apiMessage(caught, l("Rename failed.", "改名失败"))); } }}
        onShare={async () => { try { const share = await coursesApi.share(course.id); await navigator.clipboard?.writeText(share.url).catch(() => undefined); window.prompt(l("Share link (copy attempted)", "分享链接（已尝试复制）"), share.url); } catch (caught) { setError(apiMessage(caught, l("Could not create a share link.", "无法创建分享链接"))); } }}
        onRevokeShare={async () => { try { const active = await coursesApi.shares(course.id); if (!active.length) return toast(l("There are no active share links.", "当前没有有效分享链接"), "info"); if (!window.confirm(l("Revoke the current share link? Anyone with the old link will no longer be able to preview or clone it.", "撤销当前分享链接？持有旧链接的人将无法继续预览或克隆。"))) return; await coursesApi.revokeShare(active[0].id); toast(l("Share link revoked", "分享链接已撤销"), "check"); } catch (caught) { setError(apiMessage(caught, l("Could not revoke the share link.", "无法撤销分享链接"))); } }}
        onPublish={async () => { const description = window.prompt(l("Course description (500 characters maximum)", "课程简介（最多 500 字）"), "") ?? null; if (description == null || !window.confirm(l("I confirm that I have the right to publish this text and agree to offer the course for free.", "我确认拥有这些文本内容的发布权利，并同意课程免费提供。"))) return; try { await coursesApi.publish(course.id, description); toast(l("Course version published as free", "课程版本已上架，市场中显示为免费"), "check"); } catch (caught) { setError(apiMessage(caught, l("Could not publish the course.", "无法上架课程"))); } }}
        onDelete={async () => { if (!window.confirm(l(`Delete “${course.title}”? Its learning history and review schedules will be deleted. Awarded points and badge history are retained.`, `删除“${course.title}”？学习记录和复习计划会一并删除，已发放积分与徽章历史保留。`))) return; try { await coursesApi.remove(course.id); toast(l("Course deleted", "课程已删除"), "check"); await load(); } catch (caught) { setError(apiMessage(caught, l("Could not delete the course.", "无法删除课程"))); } }} />)}</div>}
    {picker && <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && setPicker(null)}><div className="modal"><div className="modal-pad">
      <div className="row between"><h2>{picker.mode === "initial" ? l("Choose a unit", "选择学习单元") : l("Start review", "开始复习")}</h2><button className="icon-btn" aria-label={l("Close", "关闭")} onClick={() => setPicker(null)}>×</button></div>
      <label className="course-label">{l("Unit", "单元")}</label><select className="course-form-field" value={picker.unitId} onChange={(event) => setPicker({ ...picker, unitId: event.target.value })}>{picker.course.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.isSystem ? l("All vocabulary", "全部词表") : unit.name} · {l(`${unit.words.length} words`, `${unit.words.length} 词`)}</option>)}</select>
      <div className="row wrap-flex mt-12"><button className="btn btn-sm" onClick={() => void downloadPickedUnit()}>{pickerAudio.running
        ? l("Stop audio download", "停止音频下载")
        : l("Download this unit's audio", "下载本单元音频")}</button>
        {pickerAudio.cached > 0 && <button className="btn btn-sm" onClick={() => void removePickedAudio()}>{l("Remove local audio", "删除本地音频")}</button>}</div>
      {pickerAudio.manifest && <div className="faint mt-8">{l(
        `${pickerAudio.cached}/${pickerAudio.manifest.total} stored locally · ${pickerAudio.manifest.pending - quotaPausedAudioCount(pickerAudio.manifest)} preparing · ${quotaPausedAudioCount(pickerAudio.manifest)} quota-paused · ${pickerAudio.manifest.failed} failed${pickerAudio.persistent ? " · persistent storage requested" : ""}`,
        `本地已保存 ${pickerAudio.cached}/${pickerAudio.manifest.total} 个 · ${pickerAudio.manifest.pending - quotaPausedAudioCount(pickerAudio.manifest)} 个准备中 · ${quotaPausedAudioCount(pickerAudio.manifest)} 个因配额暂停 · ${pickerAudio.manifest.failed} 个失败${pickerAudio.persistent ? " · 已申请持久存储" : ""}`,
      )}</div>}
      {picker.mode === "review" && picker.scheduleId && <div className="course-feedback">{l("This review came from Schedule. It will use the saved skills and scope, then mark the schedule complete when the session finishes.", "此复习来自 Schedule，将按日程保存的测试项目与范围开始；完成会话后日程自动标记完成。")}</div>}
      {picker.mode === "review" && !picker.scheduleId && <><div className="course-label">{l("Skills", "测试项目")}</div><div className="row wrap-flex">{(["pronunciation", "translation", "spelling"] as LearningSkill[]).map((skill) => <label className="chip chip-outline" key={skill}><input type="checkbox" checked={picker.skills.includes(skill)}
        onChange={(event) => setPicker({ ...picker, skills: event.target.checked ? [...picker.skills, skill] : picker.skills.filter((value) => value !== skill) })} /> {skill === "pronunciation" ? l("Pronunciation match", "发音匹配") : skill === "translation" ? l("Translation", "翻译") : l("Spelling", "拼写")}</label>)}</div>
        <div className="course-label">{l("Scope", "范围")}</div><div className="row"><label className="chip chip-outline"><input type="radio" checked={picker.scope === "all"} onChange={() => setPicker({ ...picker, scope: "all" })} /> {l("All words", "全部单词")}</label>
          <label className="chip chip-outline"><input type="radio" checked={picker.scope === "unlearned"} onChange={() => setPicker({ ...picker, scope: "unlearned" })} /> {l("Not yet mastered", "尚未熟练")}</label></div></>}
      <div className="row mt-24" style={{ justifyContent: "flex-end" }}><button className="btn" onClick={() => setPicker(null)}>{l("Cancel", "取消")}</button><button className="btn btn-primary" disabled={!picker.skills.length} onClick={() => void startPicked()}>{picker.mode === "initial" ? l("Start learning", "开始学习") : l("Start review", "开始复习")}</button></div>
    </div></div></div>}
  </div>;
}
