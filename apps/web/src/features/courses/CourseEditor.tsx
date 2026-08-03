import { useMemo, useState } from "react";
import {
  DndContext, KeyboardSensor, PointerSensor, TouchSensor, closestCenter,
  useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { LearningCourseInput, VocabularyUnitInput, VocabularyWord, VocabularyWordInput } from "@nalanda/types";
import { parseVocabularyText, randomCourseId, type VocabularyParseError } from "./parser";
import { useI18n } from "../../i18n";
import { CourseLocaleButton } from "./CourseLocaleButton";
import { VocabularyErrorList } from "./VocabularyErrorList";

const TERM = /^[A-Za-z0-9][A-Za-z0-9 .'’\-]*$/;

export function moveCourseWord(
  course: LearningCourseInput,
  wordId: string,
  fromUnitId: string,
  toUnitId: string,
  toIndex?: number,
): LearningCourseInput {
  if (fromUnitId === toUnitId && toIndex == null) return course;
  const units = course.units.map((unit) => ({ ...unit, words: [...unit.words] }));
  const source = units.find((unit) => unit.id === fromUnitId);
  const target = units.find((unit) => unit.id === toUnitId);
  const index = source?.words.findIndex((word) => word.id === wordId) ?? -1;
  if (!source || !target || index < 0) return course;
  const [word] = source.words.splice(index, 1);
  target.words.splice(Math.max(0, Math.min(target.words.length, toIndex ?? target.words.length)), 0, word);
  return { ...course, units };
}

function SortableWord({
  word, unitId, units, progress, onChange, onMove, onStep, onDelete,
}: {
  word: VocabularyWordInput;
  unitId: string;
  units: VocabularyUnitInput[];
  progress?: VocabularyWord["progress"];
  onChange: (patch: Partial<VocabularyWordInput>) => void;
  onMove: (unitId: string) => void;
  onStep: (delta: number) => void;
  onDelete: () => void;
}) {
  const { l } = useI18n();
  const sortable = useSortable({ id: `word:${word.id}`, data: { unitId, wordId: word.id } });
  const updateTranslation = (index: number, value: string) => onChange({
    translations: word.translations.map((translation, translationIndex) => translationIndex === index ? value : translation),
  });
  const removeTranslation = (index: number) => onChange({ translations: word.translations.filter((_, translationIndex) => translationIndex !== index) });
  return <div ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
    className={`course-word-row ${sortable.isDragging ? "is-dragging" : ""}`}>
    <button className="course-drag" type="button" aria-label={l(`Drag ${word.term}`, `拖动 ${word.term}`)} {...sortable.attributes} {...sortable.listeners}>⠿</button>
    <input className="course-form-field" aria-label={l("English", "英文")} value={word.term} maxLength={120}
      onChange={(event) => onChange({ term: event.target.value, ipa: null })} />
    <input className="course-form-field" aria-label={l("IPA", "音标")} value={word.ipa || ""} maxLength={120} placeholder={l("IPA not available", "音标待补充")}
      onChange={(event) => onChange({ ipa: event.target.value || null })} />
    <div className="course-translations" role="group" aria-label={l("Translations", "翻译")}>
      {word.translations.map((translation, index) => <div className="course-translation-item" key={index}>
        <input className="course-form-field" aria-label={l(`Translation ${index + 1}`, `翻译 ${index + 1}`)} value={translation} maxLength={120}
          onChange={(event) => updateTranslation(index, event.target.value)} />
        <button type="button" disabled={word.translations.length === 1} aria-label={l(`Remove translation ${index + 1}`, `删除翻译 ${index + 1}`)}
          onClick={() => removeTranslation(index)}>×</button>
      </div>)}
      <button className="course-translation-add" type="button" disabled={word.translations.length >= 10}
        onClick={() => onChange({ translations: [...word.translations, ""] })}>＋ {l("Translation", "翻译")}</button>
    </div>
    {progress ? <div className="course-word-progress" aria-label={l(`Progress for ${word.term}`, `${word.term} 的学习属性`)}>
      <span className={progress.learnedAt ? "is-learned" : ""}>{progress.learnedAt ? l("Learned", "已学习") : l("Not learned", "未学习")}</span>
      <small className={progress.spellingExamPassedAt ? "is-learned" : ""}>{progress.spellingExamPassedAt
        ? l("Spelling exam passed", "已通过拼写考试") : l("Spelling exam pending", "待通过拼写考试")}</small>
      <small className={progress.pronunciationExamPassedAt ? "is-learned" : ""}>{progress.pronunciationExamPassedAt
        ? l("Pronunciation exam passed", "已通过发音考试") : l("Pronunciation exam pending", "待通过发音考试")}</small>
      <small>{l(`${progress.wrongCount} errors`, `错误 ${progress.wrongCount} 次`)}</small>
      <small>{l(`${progress.reviewCount} reviews`, `复习 ${progress.reviewCount} 次`)}</small>
    </div> : <div className="course-word-progress faint">{l("New word", "新单词")}</div>}
    <div className="course-icon-actions">
      <button type="button" aria-label={l("Move word up", "上移单词")} onClick={() => onStep(-1)}>↑</button>
      <button type="button" aria-label={l("Move word down", "下移单词")} onClick={() => onStep(1)}>↓</button>
      {units.length > 1 && <select aria-label={l("Move to unit", "移动到单元")} className="course-form-field" value={unitId}
        onChange={(event) => onMove(event.target.value)}>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</select>}
      <button type="button" aria-label={l("Delete word", "删除单词")} onClick={onDelete}>×</button>
    </div>
  </div>;
}

function validate(course: LearningCourseInput, l: (english: string, chinese: string) => string) {
  if (!course.title.trim() || course.title.trim().length > 80) return l("The course name must be 1–80 characters.", "课程名称需为 1–80 个字符");
  if (!course.units.length || course.units.length > 100) return l("A course must contain 1–100 units.", "课程需包含 1–100 个单元");
  const all = course.units.flatMap((unit) => unit.words);
  const distinct = new Set(all.map((word) => word.term.trim().replace(/\s+/g, " ").toLowerCase()));
  if (all.length > 2_000 || distinct.size < 4) return l("A course must contain 4–2,000 distinct words or phrases.", "课程需包含 4–2,000 个不同词或短语");
  for (const unit of course.units) {
    if (!unit.name.trim() || unit.name.trim().length > 80 || !unit.words.length) return l("Each unit needs a 1–80 character name and at least one word.", "每个单元都需要 1–80 个字符的名称和至少一个词");
    const seen = new Set<string>();
    for (const word of unit.words) {
      const term = word.term.trim().replace(/\s+/g, " ");
      const key = term.toLowerCase();
      if (!term || term.length > 120 || !/[A-Za-z]/.test(term) || !TERM.test(term)) return l(`“${word.term || "blank"}” is not a valid English term.`, `“${word.term || "空白"}”的英文格式无效`);
      if (seen.has(key)) return l(`${unit.name} contains the duplicate term “${term}”.`, `${unit.name} 中存在重复词“${term}”`);
      seen.add(key);
      if (!word.translations.length || word.translations.length > 10 || word.translations.some((value) => !value.trim() || value.length > 120)) {
        return l(`“${term}” needs 1–10 valid translations.`, `“${term}”需要 1–10 个有效翻译`);
      }
      if (new Set(word.translations.map((value) => value.trim().toLocaleLowerCase())).size !== word.translations.length) {
        return l(`Translations for “${term}” cannot be duplicated.`, `“${term}”的翻译不能重复`);
      }
      if (word.ipa && word.ipa.trim().length > 120) return l(`IPA for “${term}” cannot exceed 120 characters.`, `“${term}”的音标不能超过 120 个字符`);
    }
  }
  return "";
}

export function CourseEditor({ initial, existing, progressByWord = {}, onCancel, onSave }: {
  initial: LearningCourseInput;
  existing: boolean;
  progressByWord?: Record<string, VocabularyWord["progress"]>;
  onCancel: () => void;
  onSave: (course: LearningCourseInput) => Promise<void>;
}) {
  const { l } = useI18n();
  const [course, setCourse] = useState<LearningCourseInput>(() => structuredClone(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [bulk, setBulk] = useState<{ unitId: string; text: string; errors: VocabularyParseError[]; message: string } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(TouchSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const wordIds = useMemo(() => course.units.flatMap((unit) => unit.words.map((word) => `word:${word.id}`)), [course]);

  const updateUnit = (unitId: string, update: (unit: VocabularyUnitInput) => VocabularyUnitInput) => setCourse((current) => ({
    ...current, units: current.units.map((unit) => unit.id === unitId ? update(unit) : unit),
  }));
  const stepUnit = (index: number, delta: number) => setCourse((current) => ({
    ...current, units: arrayMove(current.units, index, Math.max(0, Math.min(current.units.length - 1, index + delta))),
  }));
  const moveWord = (wordId: string, fromUnitId: string, toUnitId: string, toIndex?: number) =>
    setCourse((current) => moveCourseWord(current, wordId, fromUnitId, toUnitId, toIndex));
  const appendPastedWords = (unitId: string) => {
    if (!bulk || bulk.unitId !== unitId) return;
    const unit = course.units.find((entry) => entry.id === unitId);
    if (!unit) return;
    const result = parseVocabularyText(bulk.text, { existingTerms: unit.words.map((word) => word.term) });
    const errors = result.errors.length ? result.errors : result.nonEmptyLines === 0
      ? [{ code: "EMPTY_UNIT", message: "The pasted vocabulary list cannot be empty.", line: 1, column: 1, length: 1, source: "" } satisfies VocabularyParseError]
      : [];
    if (errors.length) return setBulk({ ...bulk, errors, message: l("Fix the highlighted errors first.", "请先修正标红位置") });
    const currentCount = course.units.reduce((sum, entry) => sum + entry.words.length, 0);
    if (currentCount + result.words.length > 2_000) {
      return setBulk({ ...bulk, errors: [], message: l("A course can contain at most 2,000 words or phrases.", "整门课程最多包含 2,000 个词或短语") });
    }
    updateUnit(unitId, (current) => ({ ...current, words: [...current.words, ...result.words] }));
    setBulk(null); setError("");
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const activeId = String(active.id).replace(/^word:/, "");
    const overRaw = String(over.id);
    const source = course.units.find((unit) => unit.words.some((word) => word.id === activeId));
    if (!source) return;
    if (overRaw.startsWith("unit:")) return moveWord(activeId, source.id, overRaw.slice(5));
    const overId = overRaw.replace(/^word:/, "");
    const target = course.units.find((unit) => unit.words.some((word) => word.id === overId));
    if (!target) return;
    moveWord(activeId, source.id, target.id, target.words.findIndex((word) => word.id === overId));
  };

  const save = async () => {
    const normalized: LearningCourseInput = { ...course, title: course.title.trim(), units: course.units.map((unit) => ({
      ...unit, name: unit.name.trim(), words: unit.words.map((word) => ({ ...word,
        term: word.term.trim().replace(/\s+/g, " "), translations: word.translations.map((value) => value.trim()), ipa: word.ipa?.trim() || null })),
    })) };
    const message = validate(normalized, l);
    if (message) return setError(message);
    setSaving(true); setError("");
    try { await onSave(normalized); }
    catch (caught) { setError(caught instanceof Error ? caught.message : l("Could not save the course.", "保存失败")); setSaving(false); }
  };

  return <div className="wrap wrap-wide courses-root">
    <div className="page-head"><div><div className="eyebrow">{l("English vocabulary", "英语单词")}</div>
      <h1 className="page-title">{existing ? l("Edit course", "编辑课程") : l("Review course content", "确认课程内容")}</h1>
      <p className="page-sub">{l("A word is learned only after passing both its spelling and pronunciation exams. Changing a term resets both exam passes; changing translations resets spelling, and changing IPA resets pronunciation. Reordering, moving, and renaming do not reset progress.", "单词只有同时通过拼写考试和发音考试才标为已学习。修改英文会重置两项考试；修改翻译会重置拼写考试，修改音标会重置发音考试。排序、移动和改名不会重置进度。")}</p></div>
      <div className="row"><CourseLocaleButton /><button className="btn" onClick={onCancel}>{l("Cancel", "取消")}</button><button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? l("Saving…", "保存中…") : l("Save course", "保存课程")}</button></div>
    </div>
    <label className="course-label" htmlFor="course-title">{l("Course name", "课程名称")}</label>
    <input id="course-title" className="course-form-field" maxLength={80} value={course.title}
      onChange={(event) => setCourse((current) => ({ ...current, title: event.target.value }))} />
    {error && <div role="alert" className="course-feedback wrong">{error}</div>}
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={wordIds} strategy={verticalListSortingStrategy}>
        {course.units.map((unit, unitIndex) => <section className="course-editor-unit" key={unit.id} id={`unit:${unit.id}`}>
          <div className="row between wrap-flex">
            {course.hasUnits ? <input className="course-form-field" style={{ maxWidth: 360 }} aria-label={l("Unit name", "单元名称")} maxLength={80} value={unit.name}
              onChange={(event) => updateUnit(unit.id, (current) => ({ ...current, name: event.target.value }))} />
              : <h2 className="serif" style={{ fontSize: 18 }}>{l("Vocabulary", "词表")}</h2>}
            <div className="row">
              {course.hasUnits && <><button className="btn btn-sm" disabled={unitIndex === 0} onClick={() => stepUnit(unitIndex, -1)}>{l("Move unit up", "单元上移")}</button>
                <button className="btn btn-sm" disabled={unitIndex === course.units.length - 1} onClick={() => stepUnit(unitIndex, 1)}>{l("Move unit down", "单元下移")}</button></>}
              {course.hasUnits && course.units.length > 1 && <button className="btn btn-sm" onClick={() => { setCourse((current) => ({ ...current, units: current.units.filter((entry) => entry.id !== unit.id) })); if (bulk?.unitId === unit.id) setBulk(null); }}>{l("Delete unit", "删除单元")}</button>}
            </div>
          </div>
          {unit.words.map((word, wordIndex) => <SortableWord key={word.id} word={word} unitId={unit.id} units={course.units}
            progress={progressByWord[word.id]}
            onChange={(patch) => updateUnit(unit.id, (current) => ({ ...current, words: current.words.map((entry) => entry.id === word.id ? { ...entry, ...patch } : entry) }))}
            onMove={(target) => moveWord(word.id, unit.id, target)}
            onStep={(delta) => updateUnit(unit.id, (current) => ({ ...current, words: arrayMove(current.words, wordIndex,
              Math.max(0, Math.min(current.words.length - 1, wordIndex + delta))) }))}
            onDelete={() => updateUnit(unit.id, (current) => ({ ...current, words: current.words.filter((entry) => entry.id !== word.id) }))} />)}
          <div className="row wrap-flex mt-12"><button className="btn btn-sm" onClick={() => updateUnit(unit.id, (current) => ({ ...current,
            words: [...current.words, { id: randomCourseId(), term: "", translations: [""], ipa: null }] }))}>＋ {l("Add word", "添加单词")}</button>
            <button className="btn btn-sm" onClick={() => setBulk((current) => current?.unitId === unit.id ? null : { unitId: unit.id, text: "", errors: [], message: "" })}>⌨ {l("Paste multiple words", "批量粘贴单词")}</button></div>
          {bulk?.unitId === unit.id && <div className="course-bulk-paste mt-12">
            <label className="course-label" htmlFor={`bulk-${unit.id}`}>{l(`Paste words into ${unit.name}`, `批量添加到 ${unit.name}`)}</label>
            <p className="muted">{l("Use one word or phrase per line. Separate multiple translations with /.", "每行一个词或短语，多个翻译用 / 分隔。")}</p>
            <textarea id={`bulk-${unit.id}`} className="course-form-field course-paste mt-8" aria-label={l(`${unit.name} bulk vocabulary`, `${unit.name} 批量词表`)}
              value={bulk.text} onChange={(event) => setBulk({ ...bulk, text: event.target.value, errors: [], message: "" })}
              placeholder={'apple 苹果\ntake part in 参加/参与'} />
            <VocabularyErrorList errors={bulk.errors} />
            {bulk.message && <div className="course-feedback wrong" role="alert">{bulk.message}</div>}
            <div className="row mt-12"><button className="btn btn-sm" onClick={() => setBulk(null)}>{l("Cancel", "取消")}</button>
              <button className="btn btn-primary btn-sm" onClick={() => appendPastedWords(unit.id)}>{l("Add pasted words", "添加粘贴的单词")}</button></div>
          </div>}
        </section>)}
      </SortableContext>
    </DndContext>
    {course.hasUnits && course.units.length < 100 && <button className="btn" onClick={() => setCourse((current) => ({ ...current,
      units: [...current.units, { id: randomCourseId(), name: `Unit ${current.units.length + 1}`, isSystem: false, words: [] }] }))}>＋ {l("Add unit", "添加单元")}</button>}
  </div>;
}
