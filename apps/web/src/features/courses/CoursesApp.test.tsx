import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningCourseInput } from "@nalanda/types";
import { CoursesApp } from "./CoursesApp";
import { CourseEditor, moveCourseWord } from "./CourseEditor";
import { setLocale } from "../../i18n";

const ids = [
  "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666",
  "77777777-7777-4777-8777-777777777777", "88888888-8888-4888-8888-888888888888",
];

const response = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
async function settle(work?: () => void | Promise<void>) { await act(async () => { await work?.(); await Promise.resolve(); await Promise.resolve(); }); }
function clickText(container: Element, text: string) {
  const button = [...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes(text));
  if (!button) throw new Error(`button not found: ${text}`); button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}
function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value); element.dispatchEvent(new Event("input", { bubbles: true }));
}
const progress = { recognitionSeen: false, initialPronunciationPassed: false, initialTranslationPassed: false, initialSpellingPassed: false,
  pronunciationReviewDates: [], translationReviewDates: [], spellingReviewDates: [], wrongCount: 0, reviewCount: 0, learnedAt: null };

describe("Courses React UI", () => {
  let root: Root; let container: HTMLDivElement;
  beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(async () => { await settle(() => root.unmount()); vi.unstubAllGlobals(); });

  it("renders the empty state and disables the three future categories and AI file import", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response([])));
    await settle(() => root.render(<CoursesApp />));
    expect(container.textContent).toContain("No learning courses yet");
    await settle(() => clickText(container, "中文"));
    expect(localStorage.getItem("nalanda-locale")).toBe("zh");
    expect(container.textContent).toContain("还没有学习课程");
    await settle(() => clickText(container, "创建第一门课程"));
    expect(container.querySelectorAll(".course-choice")).toHaveLength(4);
    expect(container.querySelectorAll(".course-choice:disabled")).toHaveLength(3);
    await settle(() => clickText(container, "英语单词学习"));
    expect(container.textContent).toContain("AI 解析即将推出");
    expect([...container.querySelectorAll("button")].find((button) => button.textContent?.includes("上传文件"))?.disabled).toBe(true);
  });

  it("marks exact paste errors red, supports multiple units, and enters the structured editor only after fixing", async () => {
    setLocale("zh");
    vi.stubGlobal("fetch", vi.fn(() => response([])));
    await settle(() => root.render(<CoursesApp />));
    await settle(() => clickText(container, "创建第一门课程")); await settle(() => clickText(container, "英语单词学习"));
    await settle(() => clickText(container, "复制文本词表"));
    const title = container.querySelector("#new-course-title") as HTMLInputElement;
    await settle(() => { setValue(title, "多单元课程"); (container.querySelectorAll('input[type="radio"]')[1] as HTMLInputElement).click(); });
    await settle(() => clickText(container, "继续")); await settle(() => clickText(container, "新建单元"));
    const areas = container.querySelectorAll("textarea");
    await settle(() => { setValue(areas[0], "apple 苹果\napple 水果"); setValue(areas[1], "pear 梨\norange 橙子"); clickText(container, "解析并进入编辑"); });
    expect(container.textContent).toContain("DUPLICATE_TERM"); expect(container.querySelector("mark")?.textContent).toBe("apple");
    await settle(() => { setValue(areas[0], "apple 苹果\nbanana 香蕉"); clickText(container, "解析并进入编辑"); });
    expect(container.textContent).toContain("确认课程内容");
    expect(container.querySelectorAll('[aria-label="单元名称"]')).toHaveLength(2);
  });

  it("provides keyboard ordering controls and surfaces save failures", async () => {
    setLocale("zh");
    const initial: LearningCourseInput = { id: ids[0], title: "Course", category: "english_vocabulary", hasUnits: false, locale: "en-US",
      units: [{ id: ids[1], name: "默认单元", isSystem: true, words: ["apple", "pear", "orange", "banana"].map((term, index) => ({ id: ids[index + 2], term, translations: [`译${index}`], ipa: null })) }] };
    const save = vi.fn().mockRejectedValue(new Error("数据库保存失败"));
    await settle(() => root.render(<CourseEditor initial={initial} existing={false} onCancel={() => {}} onSave={save} />));
    const up = container.querySelectorAll('[aria-label="上移单词"]')[1] as HTMLButtonElement;
    await settle(() => up.click());
    expect((container.querySelectorAll('[aria-label="英文"]')[0] as HTMLInputElement).value).toBe("pear");
    await settle(() => clickText(container, "保存课程"));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("数据库保存失败");
  });

  it("applies same-unit and cross-unit drag ordering without mutating the editor source", () => {
    const initial: LearningCourseInput = { id: ids[0], title: "Course", category: "english_vocabulary", hasUnits: true, locale: "en-US",
      units: [
        { id: ids[1], name: "Unit 1", isSystem: false, words: [
          { id: ids[3], term: "apple", translations: ["苹果"], ipa: null },
          { id: ids[4], term: "pear", translations: ["梨"], ipa: null },
        ] },
        { id: ids[2], name: "Unit 2", isSystem: false, words: [
          { id: ids[5], term: "orange", translations: ["橙子"], ipa: null },
          { id: ids[6], term: "banana", translations: ["香蕉"], ipa: null },
        ] },
      ] };

    const reordered = moveCourseWord(initial, ids[4], ids[1], ids[1], 0);
    expect(reordered.units[0].words.map((word) => word.term)).toEqual(["pear", "apple"]);
    const moved = moveCourseWord(reordered, ids[3], ids[1], ids[2], 1);
    expect(moved.units[0].words.map((word) => word.term)).toEqual(["pear"]);
    expect(moved.units[1].words.map((word) => word.term)).toEqual(["orange", "apple", "banana"]);
    expect(initial.units.map((unit) => unit.words.map((word) => word.term))).toEqual([["apple", "pear"], ["orange", "banana"]]);
  });

  it("moves words across units and clears a stale IPA when the English spelling changes", async () => {
    setLocale("zh");
    const initial: LearningCourseInput = { id: ids[0], title: "Course", category: "english_vocabulary", hasUnits: true, locale: "en-US",
      units: [
        { id: ids[1], name: "Unit 1", isSystem: false, words: [
          { id: ids[3], term: "apple", translations: ["苹果"], ipa: "/old/" },
          { id: ids[4], term: "pear", translations: ["梨"], ipa: null },
        ] },
        { id: ids[2], name: "Unit 2", isSystem: false, words: [
          { id: ids[5], term: "orange", translations: ["橙子"], ipa: null },
          { id: ids[6], term: "banana", translations: ["香蕉"], ipa: null },
        ] },
      ] };
    const save = vi.fn().mockResolvedValue(undefined);
    await settle(() => root.render(<CourseEditor initial={initial} existing onCancel={() => {}} onSave={save} />));
    const firstTerm = container.querySelectorAll('[aria-label="英文"]')[0] as HTMLInputElement;
    await settle(() => setValue(firstTerm, "apples"));
    expect((container.querySelectorAll('[aria-label="音标"]')[0] as HTMLInputElement).value).toBe("");
    const move = container.querySelectorAll('[aria-label="移动到单元"]')[0] as HTMLSelectElement;
    await settle(() => { move.value = ids[2]; move.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(container.querySelectorAll(".course-editor-unit")[0].querySelectorAll('[aria-label="英文"]')).toHaveLength(1);
    expect(container.querySelectorAll(".course-editor-unit")[1].querySelectorAll('[aria-label="英文"]')).toHaveLength(3);
    await settle(() => clickText(container, "保存课程"));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      units: expect.arrayContaining([expect.objectContaining({
        id: ids[2], words: expect.arrayContaining([expect.objectContaining({ term: "apples", ipa: null })]),
      })]),
    }));
  });

  it("toggles mastery counts and resumes the unique persisted session", async () => {
    setLocale("zh");
    const summary = { id: ids[0], title: "Resume me", category: "english_vocabulary", hasUnits: false, locale: "en-US", unitCount: 1,
      wordCount: 4, learnedCount: 1, progressPercent: 25, activeSessionId: ids[5], canRepublish: true,
      originPublicationId: null, originShareId: null, originAuthorName: null, updatedAt: new Date().toISOString() };
    const words = ["apple", "pear", "orange", "banana"].map((term, index) => ({ id: ids[index + 2], term, normalizedTerm: term,
      translations: [`译${index}`], ipa: null, position: index, progress }));
    const detail = { ...summary, units: [{ id: ids[1], name: "默认单元", position: 0, isSystem: true, words }] };
    const session = { id: ids[5], courseId: ids[0], unitId: ids[1], mode: "initial", scope: "all", selectedSkills: ["pronunciation", "translation", "spelling"],
      stage: "recognition", active: true, state: { queue: words.map((word) => word.id), cursor: 0, nextQueue: [], round: 1 },
      items: words.map((word, position) => ({ word, position, recognitionSeen: false, pronunciationPassed: false, translationPassed: false, spellingPassed: false, wrongCount: 0 })) };
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const path = String(input); if (path.endsWith(`/learning-sessions/${ids[5]}`)) return response(session);
      if (path.endsWith(`/learning-courses/${ids[0]}`)) return response(detail); return response([summary]);
    }));
    await settle(() => root.render(<CoursesApp />));
    expect(container.textContent).toContain("25%");
    await settle(() => (container.querySelector(".course-card-progress") as HTMLElement).click()); expect(container.textContent).toContain("1/4");
    await settle(() => clickText(container, "继续学习"));
    expect(container.textContent).toContain("认单词"); expect(container.textContent).toContain("apple");
  });

  it("shows standardized API errors instead of silently treating them as empty data", async () => {
    vi.stubGlobal("fetch", vi.fn(() => response({ code: "DATABASE_ERROR", message: "课程数据库不可用" }, 503)));
    await settle(() => root.render(<CoursesApp />));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("course database is temporarily unavailable");
  });
});
