import { useCallback, useEffect, useState } from "react";
import type {
  LearningCourseDetail, LearningCourseInput, LearningCourseSummary, LearningScope, LearningSkill,
  VocabularyUnitInput,
} from "@nalanda/types";
import { coursesApi } from "./api";
import { CourseEditor } from "./CourseEditor";
import { LearningView } from "./LearningView";
import { parseVocabularyText, randomCourseId, type VocabularyParseError } from "./parser";
import "./courses.css";

type WizardStep = "category" | "source" | "setup" | "paste";
type PasteUnit = { id: string; name: string; isSystem: boolean; text: string; errors: VocabularyParseError[] };

const CATEGORIES = [
  { id: "english_vocabulary", icon: "Aa", name: "英语单词学习", description: "词卡、发音、翻译、拼写与跨日复习", enabled: true },
  { id: "knowledge_points", icon: "◇", name: "知识点学习", description: "适用于概念与知识图谱", enabled: false },
  { id: "reading_comprehension", icon: "¶", name: "阅读理解", description: "适用于文章精读与理解训练", enabled: false },
  { id: "question_bank", icon: "✓", name: "题库训练", description: "适用于题目与错题循环", enabled: false },
];

function apiMessage(error: unknown) { return error instanceof Error ? error.message : "操作失败，请重试"; }

function ErrorLines({ errors }: { errors: VocabularyParseError[] }) {
  if (!errors.length) return null;
  return <div className="course-errors" role="alert">{errors.map((entry, index) => {
    const start = Math.max(0, entry.column - 1); const end = start + entry.length;
    return <div className="course-error-line" key={`${entry.line}-${entry.code}-${index}`}><b>第 {entry.line} 行</b><div>
      <span>{entry.source.slice(0, start)}</span><mark>{entry.source.slice(start, end) || "␠"}</mark><span>{entry.source.slice(end)}</span>
      <div style={{ color: "var(--pink)" }}>{entry.code}：{entry.message}</div>
    </div></div>;
  })}</div>;
}

function Wizard({ onCancel, onReady }: { onCancel: () => void; onReady: (value: LearningCourseInput) => void }) {
  const [step, setStep] = useState<WizardStep>("category");
  const [title, setTitle] = useState("");
  const [hasUnits, setHasUnits] = useState(false);
  const [units, setUnits] = useState<PasteUnit[]>([]);
  const [error, setError] = useState("");

  const beginPaste = () => {
    if (!title.trim()) return setError("请填写课程名称");
    setUnits([{ id: randomCourseId(), name: hasUnits ? "Unit 1" : "默认单元", isSystem: !hasUnits, text: "", errors: [] }]);
    setError(""); setStep("paste");
  };
  const parseAll = (override?: PasteUnit[]) => {
    const source = override || units;
    const parsed = source.map((unit) => ({ unit, result: parseVocabularyText(unit.text) }));
    const next = parsed.map(({ unit, result }) => ({ ...unit, errors: result.errors.length ? result.errors
      : result.nonEmptyLines === 0 ? [{ code: "EMPTY_TERM", message: "单元词表不能为空", line: 1, column: 1, length: 1, source: "" } satisfies VocabularyParseError] : [] }));
    setUnits(next);
    const words = parsed.flatMap(({ result }) => result.words);
    const distinct = new Set(words.map((word) => word.term.trim().replace(/\s+/g, " ").toLowerCase()));
    if (next.some((unit) => unit.errors.length)) return setError("请先修正标红位置");
    if (words.length > 2_000 || distinct.size < 4) return setError("整门课程需包含 4–2,000 个不同词或短语");
    setError("");
    onReady({ id: randomCourseId(), title: title.trim(), category: "english_vocabulary", hasUnits, locale: "en-US",
      units: parsed.map(({ unit, result }): VocabularyUnitInput => ({ id: unit.id, name: unit.name.trim(), isSystem: unit.isSystem, words: result.words })) });
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

  return <div className="wrap courses-root"><div className="page-head"><div><div className="eyebrow">Create course</div>
    <h1 className="page-title">创建课程</h1><p className="page-sub">{step === "category" ? "不同类别将使用不同学习界面和后续 AI prompt。" : "首版只处理手工粘贴的英语词表。"}</p></div>
    <button className="btn" onClick={onCancel}>取消</button></div>
    {step === "category" && <><div className="course-category-grid">{CATEGORIES.map((category) => <button key={category.id} className="course-choice" disabled={!category.enabled}
      onClick={() => setStep("source")}><div className="course-choice-icon">{category.icon}</div><h2 style={{ fontSize: 18 }}>{category.name}</h2>
      <p className="muted mt-8">{category.description}</p>{!category.enabled && <span className="chip mt-12">即将推出</span>}</button>)}</div></>}
    {step === "source" && <><div className="course-category-grid">
      <button className="course-choice" onClick={() => setStep("setup")}><div className="course-choice-icon">⌨</div><h2 style={{ fontSize: 18 }}>复制文本词表</h2><p className="muted mt-8">每行一个词/短语，最后一个 ASCII 空格后填写翻译，多个翻译用 / 分隔。</p></button>
      <button className="course-choice" disabled><div className="course-choice-icon">⇧</div><h2 style={{ fontSize: 18 }}>上传文件</h2><p className="muted mt-8">PDF、Word、JSON、Markdown、HTML、图片</p><span className="chip mt-12">AI 解析即将推出</span></button>
    </div><button className="btn mt-16" onClick={() => setStep("category")}>上一步</button></>}
    {step === "setup" && <div className="card card-pad">
      <label className="course-label" htmlFor="new-course-title">课程名称 *</label><input id="new-course-title" className="course-form-field" maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：学术英语核心词汇" />
      <div className="course-label">词表结构</div><div className="row wrap-flex"><label className="chip chip-outline"><input type="radio" checked={!hasUnits} onChange={() => setHasUnits(false)} /> 无单元</label>
        <label className="chip chip-outline"><input type="radio" checked={hasUnits} onChange={() => setHasUnits(true)} /> 有单元</label></div>
      {error && <div role="alert" className="course-feedback wrong">{error}</div>}
      <div className="row mt-24"><button className="btn" onClick={() => setStep("source")}>上一步</button><button className="btn btn-primary" onClick={beginPaste}>继续</button></div>
    </div>}
    {step === "paste" && <><div className="card card-pad"><div className="row between wrap-flex"><div><h2 style={{ fontSize: 19 }}>粘贴词表</h2><p className="muted mt-4">示例：<code>take part in 参加/参与</code></p></div>
      {hasUnits && units.length < 100 && <button className="btn btn-sm" onClick={() => setUnits((current) => [...current, { id: randomCourseId(), name: `Unit ${current.length + 1}`, isSystem: false, text: "", errors: [] }])}>＋ 新建单元</button>}</div>
      {units.map((unit, index) => <div className="course-editor-unit" key={unit.id}><div className="row between">
        {hasUnits ? <input className="course-form-field" style={{ maxWidth: 330 }} aria-label="单元名称" value={unit.name} onChange={(event) => setUnits((current) => current.map((entry) => entry.id === unit.id ? { ...entry, name: event.target.value } : entry))} /> : <b>词表</b>}
        {hasUnits && units.length > 1 && <div className="course-icon-actions"><button aria-label="单元上移" onClick={() => setUnits((current) => { const next = [...current]; if (index > 0) [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>↑</button>
          <button aria-label="单元下移" onClick={() => setUnits((current) => { const next = [...current]; if (index < next.length - 1) [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })}>↓</button>
          <button aria-label="删除单元" onClick={() => setUnits((current) => current.filter((entry) => entry.id !== unit.id))}>×</button></div>}</div>
        <textarea className="course-form-field course-paste mt-12" aria-label={`${unit.name} 词表`} value={unit.text}
          onChange={(event) => updatePaste(unit.id, event.target.value)} onPaste={(event) => {
            const pasted = event.clipboardData.getData("text"); if (!pasted) return;
            event.preventDefault(); const target = event.currentTarget; const text = unit.text.slice(0, target.selectionStart) + pasted + unit.text.slice(target.selectionEnd);
            updatePaste(unit.id, text, true);
          }} placeholder={'apple 苹果\ntake part in 参加/参与'} />
        <ErrorLines errors={unit.errors} /></div>)}
      {error && <div role="alert" className="course-feedback wrong">{error}</div>}
      <div className="row mt-16"><button className="btn" onClick={() => setStep("setup")}>上一步</button><button className="btn btn-primary" onClick={() => parseAll()}>解析并进入编辑</button></div>
    </div></>}
  </div>;
}

function CourseCard({ course, countMode, setCountMode, onStart, onReview, onEdit, onRename, onShare, onRevokeShare, onPublish, onDelete }: {
  course: LearningCourseSummary; countMode: boolean; setCountMode: (value: boolean) => void;
  onStart: () => void; onReview: () => void; onEdit: () => void; onRename: () => void; onShare: () => void; onRevokeShare: () => void; onPublish: () => void; onDelete: () => void;
}) {
  return <article className="card hoverable course-card"><div className="row between"><span className="chip chip-accent">英语单词</span>{course.originAuthorName && <span className="faint" style={{ fontSize: 11 }}>来自 {course.originAuthorName}</span>}</div>
    <h2 className="serif mt-12" style={{ fontSize: 20 }}>{course.title}</h2><p className="faint mt-4">{course.hasUnits ? `${course.unitCount} 个单元` : "无单元"} · {course.wordCount} 个词</p>
    <div className="course-card-progress" tabIndex={0} onMouseEnter={() => setCountMode(true)} onMouseLeave={() => setCountMode(false)} onClick={() => setCountMode(!countMode)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") setCountMode(!countMode); }}><div className="row between"><b>{countMode ? `${course.learnedCount}/${course.wordCount}` : `${course.progressPercent}%`}</b><span className="faint">{countMode ? "已学习/全部" : "熟练度"}</span></div>
      <div className="bar mt-8"><i style={{ width: `${course.progressPercent}%` }} /></div></div>
    <div className="course-card-actions"><button className="btn btn-primary btn-sm" onClick={onStart}>{course.activeSessionId ? "继续学习" : "开始学习"}</button>
      <button className="btn btn-sm" onClick={onReview}>复习</button><button className="btn btn-sm" onClick={onEdit}>编辑</button>
      <button className="btn btn-sm" onClick={onRename}>改名</button><button className="btn btn-sm" onClick={onShare} disabled={!course.canRepublish}>分享</button>
      <button className="btn btn-sm" onClick={onRevokeShare} disabled={!course.canRepublish}>撤销分享</button>
      <button className="btn btn-sm" onClick={onPublish} disabled={!course.canRepublish}>上架市场</button><button className="btn btn-sm" onClick={onDelete}>删除</button></div>
  </article>;
}

export function CoursesApp({ toast = () => {}, initialCourseId, initialUnitId, initialScheduleId }: {
  toast?: (message: string, icon?: string) => void;
  initialCourseId?: string; initialUnitId?: string; initialScheduleId?: string;
}) {
  const [courses, setCourses] = useState<LearningCourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [wizard, setWizard] = useState(false);
  const [editing, setEditing] = useState<{ course: LearningCourseInput; existing: boolean } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [countModes, setCountModes] = useState<Record<string, boolean>>({});
  const [picker, setPicker] = useState<{ course: LearningCourseDetail; mode: "initial" | "review"; unitId: string; skills: LearningSkill[]; scope: LearningScope; scheduleId?: string } | null>(null);

  const load = useCallback(async () => { setLoading(true); try { setCourses(await coursesApi.list()); setError(""); } catch (caught) { setError(apiMessage(caught)); } setLoading(false); }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!initialCourseId || !initialUnitId) return;
    coursesApi.detail(initialCourseId).then((course) => setPicker({ course, mode: "review", unitId: initialUnitId,
      skills: ["pronunciation", "translation", "spelling"], scope: "unlearned", scheduleId: initialScheduleId })).catch((caught) => setError(apiMessage(caught)));
  }, [initialCourseId, initialUnitId, initialScheduleId]);

  const openStart = async (summary: LearningCourseSummary) => {
    if (summary.activeSessionId) return setSessionId(summary.activeSessionId);
    try {
      const course = await coursesApi.detail(summary.id);
      if (!course.hasUnits) {
        const session = await coursesApi.startSession(course.id, { unitId: course.units[0].id, mode: "initial", scope: "all", skills: ["pronunciation", "translation", "spelling"] }); setSessionId(session.id);
      } else setPicker({ course, mode: "initial", unitId: course.units[0].id, skills: ["pronunciation", "translation", "spelling"], scope: "all" });
    } catch (caught) { setError(apiMessage(caught)); }
  };
  const openReview = async (summary: LearningCourseSummary) => {
    try { const course = await coursesApi.detail(summary.id); setPicker({ course, mode: "review", unitId: course.units[0].id,
      skills: ["pronunciation", "translation", "spelling"], scope: "unlearned" }); }
    catch (caught) { setError(apiMessage(caught)); }
  };
  const startPicked = async () => {
    if (!picker || !picker.skills.length) return;
    try { const session = await coursesApi.startSession(picker.course.id, { unitId: picker.unitId, mode: picker.mode,
      skills: picker.skills, scope: picker.mode === "initial" ? "all" : picker.scope, scheduleId: picker.scheduleId }); setPicker(null); setSessionId(session.id); }
    catch (caught) { setError(apiMessage(caught)); }
  };
  const edit = async (id: string) => {
    try { const detail = await coursesApi.detail(id); setEditing({ existing: true, course: { id: detail.id, title: detail.title,
      category: "english_vocabulary", hasUnits: detail.hasUnits, locale: "en-US", units: detail.units.map((unit) => ({ id: unit.id, name: unit.name,
        isSystem: unit.isSystem, words: unit.words.map((word) => ({ id: word.id, term: word.term, translations: [...word.translations], ipa: word.ipa })) })) } }); }
    catch (caught) { setError(apiMessage(caught)); }
  };

  if (sessionId) return <LearningView sessionId={sessionId} onExit={() => { setSessionId(null); void load(); }} onChanged={() => void load()} />;
  if (editing) return <CourseEditor initial={editing.course} existing={editing.existing} onCancel={() => setEditing(null)} onSave={async (course) => {
    await coursesApi.save(course, editing.existing); setEditing(null); setWizard(false); toast("课程已保存", "check"); await load();
  }} />;
  if (wizard) return <Wizard onCancel={() => setWizard(false)} onReady={(course) => setEditing({ course, existing: false })} />;

  return <div className="wrap wrap-wide courses-root"><div className="page-head"><div><div className="eyebrow">Courses</div><h1 className="page-title">学习课程</h1>
    <p className="page-sub">创建独立的学习课程，进度会逐次保存；Materials 中的学科课程不会受影响。</p></div><button className="btn btn-primary" onClick={() => setWizard(true)}>＋ 创建课程</button></div>
    {error && <div role="alert" className="course-feedback wrong" style={{ marginBottom: 16 }}>{error}<button className="btn btn-sm" style={{ marginLeft: 12 }} onClick={() => void load()}>重试</button></div>}
    {loading ? <div className="card card-pad muted">加载课程中…</div> : courses.length === 0 ? <div className="course-empty"><div className="course-empty-icon">Aa</div>
      <h2 className="serif" style={{ fontSize: 24 }}>还没有学习课程</h2><p className="muted mt-8">从一份英语词表开始，学习、复习和熟练度会在这里持续记录。</p>
      <button className="btn btn-primary mt-24" onClick={() => setWizard(true)}>创建第一门课程</button></div>
      : <div className="course-list">{courses.map((course) => <CourseCard key={course.id} course={course} countMode={Boolean(countModes[course.id])}
        setCountMode={(value) => setCountModes((current) => ({ ...current, [course.id]: value }))} onStart={() => void openStart(course)} onReview={() => void openReview(course)} onEdit={() => void edit(course.id)}
        onRename={async () => { const title = window.prompt("新的课程名称", course.title)?.trim(); if (!title || title === course.title) return; try { await coursesApi.rename(course.id, title); toast("课程已改名", "check"); await load(); } catch (caught) { setError(apiMessage(caught)); } }}
        onShare={async () => { try { const share = await coursesApi.share(course.id); await navigator.clipboard?.writeText(share.url).catch(() => undefined); window.prompt("分享链接（已尝试复制）", share.url); } catch (caught) { setError(apiMessage(caught)); } }}
        onRevokeShare={async () => { try { const active = await coursesApi.shares(course.id); if (!active.length) return toast("当前没有有效分享链接", "info"); if (!window.confirm("撤销当前分享链接？持有旧链接的人将无法继续预览或克隆。")) return; await coursesApi.revokeShare(active[0].id); toast("分享链接已撤销", "check"); } catch (caught) { setError(apiMessage(caught)); } }}
        onPublish={async () => { const description = window.prompt("课程简介（最多 500 字）", "") ?? null; if (description == null || !window.confirm("我确认拥有这些文本内容的发布权利，并同意课程免费提供。")) return; try { await coursesApi.publish(course.id, description); toast("课程版本已上架，市场中显示为免费", "check"); } catch (caught) { setError(apiMessage(caught)); } }}
        onDelete={async () => { if (!window.confirm(`删除“${course.title}”？学习记录和复习计划会一并删除，已发放积分与徽章历史保留。`)) return; try { await coursesApi.remove(course.id); toast("课程已删除", "check"); await load(); } catch (caught) { setError(apiMessage(caught)); } }} />)}</div>}
    {picker && <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && setPicker(null)}><div className="modal"><div className="modal-pad">
      <div className="row between"><h2>{picker.mode === "initial" ? "选择学习单元" : "开始复习"}</h2><button className="icon-btn" onClick={() => setPicker(null)}>×</button></div>
      <label className="course-label">单元</label><select className="course-form-field" value={picker.unitId} onChange={(event) => setPicker({ ...picker, unitId: event.target.value })}>{picker.course.units.map((unit) => <option key={unit.id} value={unit.id}>{unit.isSystem ? "全部词表" : unit.name} · {unit.words.length} 词</option>)}</select>
      {picker.mode === "review" && picker.scheduleId && <div className="course-feedback">此复习来自 Schedule，将按日程保存的测试项目与范围开始；完成会话后日程自动标记完成。</div>}
      {picker.mode === "review" && !picker.scheduleId && <><div className="course-label">测试项目</div><div className="row wrap-flex">{(["pronunciation", "translation", "spelling"] as LearningSkill[]).map((skill) => <label className="chip chip-outline" key={skill}><input type="checkbox" checked={picker.skills.includes(skill)}
        onChange={(event) => setPicker({ ...picker, skills: event.target.checked ? [...picker.skills, skill] : picker.skills.filter((value) => value !== skill) })} /> {skill === "pronunciation" ? "发音匹配" : skill === "translation" ? "翻译" : "拼写"}</label>)}</div>
        <div className="course-label">范围</div><div className="row"><label className="chip chip-outline"><input type="radio" checked={picker.scope === "all"} onChange={() => setPicker({ ...picker, scope: "all" })} /> 全部单词</label>
          <label className="chip chip-outline"><input type="radio" checked={picker.scope === "unlearned"} onChange={() => setPicker({ ...picker, scope: "unlearned" })} /> 尚未熟练</label></div></>}
      <div className="row mt-24" style={{ justifyContent: "flex-end" }}><button className="btn" onClick={() => setPicker(null)}>取消</button><button className="btn btn-primary" disabled={!picker.skills.length} onClick={() => void startPicked()}>{picker.mode === "initial" ? "开始学习" : "开始复习"}</button></div>
    </div></div></div>}
  </div>;
}
