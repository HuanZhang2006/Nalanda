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
  if (!body.id || !UUID.test(body.id)) fieldErrors.id = "The course ID is invalid.";
  if (!body.title?.trim() || body.title.trim().length > 80) fieldErrors.title = "The course name must be 1–80 characters.";
  if (body.category !== "english_vocabulary") fieldErrors.category = "Only English vocabulary courses are supported in this version.";
  if (body.locale !== "en-US") fieldErrors.locale = "Only en-US is supported in this version.";
  if (typeof body.hasUnits !== "boolean") fieldErrors.hasUnits = "The unit mode is invalid.";
  if (!Array.isArray(body.units) || body.units.length < 1 || body.units.length > 100) {
    fieldErrors.units = "A course must contain 1–100 units.";
    throw new BadRequestException({ code: "INVALID_COURSE", message: "The course content is invalid.", fieldErrors });
  }
  const seenCourse = new Set<string>();
  const seenUnitIds = new Set<string>();
  const seenWordIds = new Set<string>();
  let total = 0;
  const units = body.units.map((rawUnit, ui): VocabularyUnitInput => {
    const unit = rawUnit as VocabularyUnitInput;
    if (!unit || typeof unit !== "object") {
      fieldErrors[`units.${ui}`] = "The unit format is invalid.";
      return { id: "", name: "", isSystem: false, words: [] };
    }
    if (!unit.id || !UUID.test(unit.id) || seenUnitIds.has(unit.id)) fieldErrors[`units.${ui}.id`] = "The unit ID is invalid or duplicated.";
    seenUnitIds.add(String(unit.id));
    if (typeof unit.name !== "string" || !unit.name.trim() || unit.name.trim().length > 80) fieldErrors[`units.${ui}.name`] = "Unit names must be 1–80 characters.";
    if (typeof unit.isSystem !== "boolean") fieldErrors[`units.${ui}.isSystem`] = "The unit type is invalid.";
    if (!Array.isArray(unit.words) || unit.words.length < 1) {
      fieldErrors[`units.${ui}.words`] = "A unit needs at least one word.";
      return { id: String(unit.id || ""), name: String(unit.name || "").trim(), isSystem: Boolean(unit.isSystem), words: [] };
    }
    const seenUnit = new Set<string>();
    const words = unit.words.map((rawWord, wi): VocabularyWordInput => {
      const word = rawWord as VocabularyWordInput;
      total += 1;
      if (!word || typeof word !== "object") {
        fieldErrors[`units.${ui}.words.${wi}`] = "The word format is invalid.";
        return { id: "", term: "", translations: [] };
      }
      const term = typeof word.term === "string" ? word.term.trim().replace(/\s+/g, " ") : "";
      const key = normalizeTerm(term);
      if (!word.id || !UUID.test(word.id) || seenWordIds.has(word.id)) fieldErrors[`units.${ui}.words.${wi}.id`] = "The word ID is invalid or duplicated.";
      seenWordIds.add(String(word.id));
      if (!key || key.length > 120 || !/[a-z]/i.test(key) || !ENGLISH.test(term)) {
        fieldErrors[`units.${ui}.words.${wi}.term`] = "The English word or phrase is invalid.";
      }
      if (seenUnit.has(key)) fieldErrors[`units.${ui}.words.${wi}.term`] = "Terms cannot repeat within a unit.";
      seenUnit.add(key); seenCourse.add(key);
      if (!Array.isArray(word.translations) || word.translations.length < 1 || word.translations.length > 10
          || word.translations.some((value) => typeof value !== "string" || !value.trim() || value.trim().length > 120)
          || new Set(word.translations.map((value) => String(value).trim().toLowerCase())).size !== word.translations.length) {
        fieldErrors[`units.${ui}.words.${wi}.translations`] = "Translations must contain 1–10 non-empty items.";
      }
      if (word.ipa != null && (typeof word.ipa !== "string" || word.ipa.trim().length > 120)) fieldErrors[`units.${ui}.words.${wi}.ipa`] = "IPA cannot exceed 120 characters.";
      return { id: String(word.id || ""), term,
        translations: Array.isArray(word.translations) ? word.translations.map((value) => String(value).trim()) : [],
        ipa: typeof word.ipa === "string" ? word.ipa.trim() || null : null };
    });
    return { id: String(unit.id || ""), name: String(unit.name || "").trim(), isSystem: Boolean(unit.isSystem), words };
  });
  if (!body.hasUnits && (units.length !== 1 || !units[0]?.isSystem)) fieldErrors.units = "A course without units must use a single hidden default unit.";
  if (total > 2000 || seenCourse.size < 4) fieldErrors.words = "A course must contain 4–2,000 distinct words or phrases.";
  if (Object.keys(fieldErrors).length) throw new BadRequestException({ code: "INVALID_COURSE", message: "The course content is invalid.", fieldErrors });
  return {
    id: body.id!, title: body.title!.trim(), category: "english_vocabulary",
    hasUnits: body.hasUnits!, locale: "en-US", units,
  };
}

const COPY_SUFFIX = " (copy)";

// Leaves room for the suffix so a clone of an 80-character title still validates.
function copyTitle(title: string) {
  return `${title.trim().slice(0, 80 - COPY_SUFFIX.length).trimEnd()}${COPY_SUFFIX}`;
}

export function cloneSnapshot(snapshot: any, baseTitle?: string): LearningCourseInput {
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
    id: randomUUID(), title: copyTitle(baseTitle || snapshot.title || "English vocabulary course"),
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
