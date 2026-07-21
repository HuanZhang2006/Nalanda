import { BadRequestException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import type { LearningCourseInput, VocabularyUnitInput, VocabularyWordInput } from "@nalanda/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENGLISH = /^[A-Za-z0-9][A-Za-z0-9 .'’\-]*$/;

export function assertUuid(value: string, field = "id") {
  if (!UUID.test(value)) throw new BadRequestException({ code: "INVALID_ID", message: `${field} is not a UUID` });
  return value;
}

export function normalizeTerm(value: string) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function validateCourseInput(raw: unknown): LearningCourseInput {
  const body = raw as Partial<LearningCourseInput>;
  const fieldErrors: Record<string, string> = {};
  if (!body || typeof body !== "object") throw new BadRequestException({ code: "INVALID_COURSE", message: "Invalid course payload" });
  if (!body.id || !UUID.test(body.id)) fieldErrors.id = "课程 ID 无效";
  if (!body.title?.trim() || body.title.trim().length > 80) fieldErrors.title = "课程名称需为 1–80 个字符";
  if (body.category !== "english_vocabulary") fieldErrors.category = "首版只支持英语单词学习";
  if (body.locale !== "en-US") fieldErrors.locale = "首版只支持 en-US";
  if (typeof body.hasUnits !== "boolean") fieldErrors.hasUnits = "单元模式无效";
  if (!Array.isArray(body.units) || body.units.length < 1 || body.units.length > 100) {
    fieldErrors.units = "课程需包含 1–100 个单元";
    throw new BadRequestException({ code: "INVALID_COURSE", message: "课程内容校验失败", fieldErrors });
  }
  const seenCourse = new Set<string>();
  const seenUnitIds = new Set<string>();
  const seenWordIds = new Set<string>();
  let total = 0;
  const units = body.units.map((rawUnit, ui): VocabularyUnitInput => {
    const unit = rawUnit as VocabularyUnitInput;
    if (!unit || typeof unit !== "object") {
      fieldErrors[`units.${ui}`] = "单元格式无效";
      return { id: "", name: "", isSystem: false, words: [] };
    }
    if (!unit.id || !UUID.test(unit.id) || seenUnitIds.has(unit.id)) fieldErrors[`units.${ui}.id`] = "单元 ID 无效或重复";
    seenUnitIds.add(String(unit.id));
    if (typeof unit.name !== "string" || !unit.name.trim() || unit.name.trim().length > 80) fieldErrors[`units.${ui}.name`] = "单元名称需为 1–80 个字符";
    if (typeof unit.isSystem !== "boolean") fieldErrors[`units.${ui}.isSystem`] = "单元类型无效";
    if (!Array.isArray(unit.words) || unit.words.length < 1) {
      fieldErrors[`units.${ui}.words`] = "单元至少需要一个词";
      return { id: String(unit.id || ""), name: String(unit.name || "").trim(), isSystem: Boolean(unit.isSystem), words: [] };
    }
    const seenUnit = new Set<string>();
    const words = unit.words.map((rawWord, wi): VocabularyWordInput => {
      const word = rawWord as VocabularyWordInput;
      total += 1;
      if (!word || typeof word !== "object") {
        fieldErrors[`units.${ui}.words.${wi}`] = "单词格式无效";
        return { id: "", term: "", translations: [] };
      }
      const term = typeof word.term === "string" ? word.term.trim().replace(/\s+/g, " ") : "";
      const key = normalizeTerm(term);
      if (!word.id || !UUID.test(word.id) || seenWordIds.has(word.id)) fieldErrors[`units.${ui}.words.${wi}.id`] = "单词 ID 无效或重复";
      seenWordIds.add(String(word.id));
      if (!key || key.length > 120 || !/[a-z]/i.test(key) || !ENGLISH.test(term)) {
        fieldErrors[`units.${ui}.words.${wi}.term`] = "英文词或短语格式无效";
      }
      if (seenUnit.has(key)) fieldErrors[`units.${ui}.words.${wi}.term`] = "同一单元内不能重复";
      seenUnit.add(key); seenCourse.add(key);
      if (!Array.isArray(word.translations) || word.translations.length < 1 || word.translations.length > 10
          || word.translations.some((value) => typeof value !== "string" || !value.trim() || value.trim().length > 120)
          || new Set(word.translations.map((value) => String(value).trim().toLowerCase())).size !== word.translations.length) {
        fieldErrors[`units.${ui}.words.${wi}.translations`] = "翻译需包含 1–10 个非空项";
      }
      if (word.ipa != null && (typeof word.ipa !== "string" || word.ipa.trim().length > 120)) fieldErrors[`units.${ui}.words.${wi}.ipa`] = "音标不能超过 120 个字符";
      return { id: String(word.id || ""), term,
        translations: Array.isArray(word.translations) ? word.translations.map((value) => String(value).trim()) : [],
        ipa: typeof word.ipa === "string" ? word.ipa.trim() || null : null };
    });
    return { id: String(unit.id || ""), name: String(unit.name || "").trim(), isSystem: Boolean(unit.isSystem), words };
  });
  if (!body.hasUnits && (units.length !== 1 || !units[0]?.isSystem)) fieldErrors.units = "无单元课程必须使用一个隐藏默认单元";
  if (total > 2000 || seenCourse.size < 4) fieldErrors.words = "课程需包含 4–2000 个不同词或短语";
  if (Object.keys(fieldErrors).length) throw new BadRequestException({ code: "INVALID_COURSE", message: "课程内容校验失败", fieldErrors });
  return {
    id: body.id!, title: body.title!.trim(), category: "english_vocabulary",
    hasUnits: body.hasUnits!, locale: "en-US", units,
  };
}

export function cloneSnapshot(snapshot: any, title?: string): LearningCourseInput {
  const units: VocabularyUnitInput[] = (snapshot.units || []).map((unit: any) => ({
    id: randomUUID(),
    name: String(unit.name || "Unit"),
    isSystem: Boolean(unit.isSystem),
    words: (unit.words || []).map((word: any): VocabularyWordInput => ({
      id: randomUUID(),
      term: String(word.term || ""),
      translations: Array.isArray(word.translations) ? word.translations.map(String) : [],
      ipa: word.ipa ? String(word.ipa) : null,
    })),
  }));
  return validateCourseInput({
    id: randomUUID(), title: title || `${snapshot.title || "英语单词课程"}（副本）`,
    category: "english_vocabulary", hasUnits: Boolean(snapshot.hasUnits), locale: "en-US", units,
  });
}

export function contentFingerprint(snapshot: any) {
  const terms = (snapshot.units || []).flatMap((unit: any) => (unit.words || []).map((word: any) => normalizeTerm(word.term)));
  return createHash("sha256").update([...new Set(terms)].sort().join("\u001f")).digest("hex");
}

export function publicSnapshot(snapshot: any) {
  return {
    title: String(snapshot.title || ""), category: "english_vocabulary" as const,
    hasUnits: Boolean(snapshot.hasUnits), locale: "en-US" as const,
    units: (snapshot.units || []).map((unit: any) => ({
      name: String(unit.name || ""), position: Number(unit.position || 0), isSystem: Boolean(unit.isSystem),
      words: (unit.words || []).map((word: any) => ({
        term: String(word.term || ""),
        translations: Array.isArray(word.translations) ? word.translations.map(String) : [],
        ipa: word.ipa ? String(word.ipa) : null,
      })),
    })),
  };
}
