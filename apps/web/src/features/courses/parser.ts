import type { VocabularyWordInput } from "@nalanda/types";

export type VocabularyParseErrorCode =
  | "MISSING_SEPARATOR"
  | "EMPTY_TERM"
  | "EMPTY_TRANSLATION"
  | "CONTINUOUS_TRANSLATION_SEPARATOR"
  | "INVALID_ENGLISH"
  | "TERM_TOO_LONG"
  | "TRANSLATION_TOO_LONG"
  | "TOO_MANY_TRANSLATIONS"
  | "DUPLICATE_TRANSLATION"
  | "DUPLICATE_TERM";

export interface VocabularyParseError {
  code: VocabularyParseErrorCode;
  message: string;
  line: number;
  column: number;
  length: number;
  source: string;
  relatedLine?: number;
}

export interface VocabularyParseResult {
  words: VocabularyWordInput[];
  errors: VocabularyParseError[];
  nonEmptyLines: number;
}

const VALID_TERM = /^[A-Za-z0-9][A-Za-z0-9 .'’\-]*$/;

export const normalizeVocabularyTerm = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

export function randomCourseId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function error(
  errors: VocabularyParseError[], code: VocabularyParseErrorCode, message: string,
  line: number, column: number, length: number, source: string, relatedLine?: number,
) {
  errors.push({ code, message, line, column: Math.max(1, column), length: Math.max(1, length), source, relatedLine });
}

export function parseVocabularyText(input: string): VocabularyParseResult {
  const words: VocabularyWordInput[] = [];
  const errors: VocabularyParseError[] = [];
  const firstLineByTerm = new Map<string, number>();
  let nonEmptyLines = 0;
  input.replace(/\r\n?/g, "\n").split("\n").forEach((source, index) => {
    const line = index + 1;
    if (!source.trim()) return;
    nonEmptyLines += 1;
    const leading = source.length - source.trimStart().length;
    const value = source.slice(leading);
    const separator = value.lastIndexOf(" ");
    if (separator < 0) {
      error(errors, "MISSING_SEPARATOR", "英文与翻译之间缺少 ASCII 空格", line, source.length + 1, 1, source);
      return;
    }
    const rawTerm = value.slice(0, separator);
    const rawTranslations = value.slice(separator + 1);
    const term = rawTerm.trim().replace(/\s+/g, " ");
    const translationColumn = leading + separator + 2;
    let invalid = false;

    if (!term) {
      error(errors, "EMPTY_TERM", "英文词或短语不能为空", line, leading + 1, Math.max(1, separator), source);
      invalid = true;
    } else if (term.length > 120) {
      error(errors, "TERM_TOO_LONG", "英文词或短语不能超过 120 个字符", line, leading + 121, term.length - 120, source);
      invalid = true;
    } else if (!/[A-Za-z]/.test(term) || !VALID_TERM.test(term)) {
      const illegal = [...rawTerm].findIndex((char, charIndex) =>
        (charIndex === 0 ? !/[A-Za-z0-9]/.test(char) : !/[A-Za-z0-9 .'’\-]/.test(char)));
      error(errors, "INVALID_ENGLISH", "英文部分只能包含英文字母、数字、空格、点、撇号和连字符", line,
        leading + (illegal >= 0 ? illegal : 0) + 1, 1, source);
      invalid = true;
    }

    const slash = rawTranslations.indexOf("//");
    if (slash >= 0) {
      error(errors, "CONTINUOUS_TRANSLATION_SEPARATOR", "多个翻译之间只能使用单个 /", line,
        translationColumn + slash, 2, source);
      invalid = true;
    }
    const translationParts = rawTranslations.split("/");
    const translations = translationParts.map((value) => value.trim());
    const emptyIndex = translations.findIndex((value) => !value);
    if (emptyIndex >= 0) {
      const before = translations.slice(0, emptyIndex).reduce((sum, value) => sum + value.length + 1, 0);
      error(errors, "EMPTY_TRANSLATION", "翻译不能为空", line, translationColumn + before, 1, source);
      invalid = true;
    }
    if (translations.length > 10) {
      const eleventh = rawTranslations.split("/").slice(0, 10).join("/").length + 1;
      error(errors, "TOO_MANY_TRANSLATIONS", "每个词最多包含 10 个翻译", line, translationColumn + eleventh, 1, source);
      invalid = true;
    }
    const seenTranslations = new Map<string, number>();
    translations.forEach((translation, translationIndex) => {
      const normalizedTranslation = translation.toLocaleLowerCase();
      const relatedIndex = seenTranslations.get(normalizedTranslation);
      if (translation && relatedIndex != null) {
        const before = translationParts.slice(0, translationIndex).reduce((sum, value) => sum + value.length + 1, 0);
        const leadingTranslation = translationParts[translationIndex].length - translationParts[translationIndex].trimStart().length;
        error(errors, "DUPLICATE_TRANSLATION", `与第 ${relatedIndex + 1} 个翻译重复`, line,
          translationColumn + before + leadingTranslation, translation.length, source);
        invalid = true;
      } else if (translation) {
        seenTranslations.set(normalizedTranslation, translationIndex);
      }
    });
    const tooLong = translations.findIndex((value) => value.length > 120);
    if (tooLong >= 0) {
      const before = translations.slice(0, tooLong).reduce((sum, value) => sum + value.length + 1, 0);
      error(errors, "TRANSLATION_TOO_LONG", "单个翻译不能超过 120 个字符", line, translationColumn + before + 120,
        translations[tooLong].length - 120, source);
      invalid = true;
    }

    const normalized = normalizeVocabularyTerm(term);
    const relatedLine = firstLineByTerm.get(normalized);
    if (normalized && relatedLine != null) {
      error(errors, "DUPLICATE_TERM", `与第 ${relatedLine} 行重复`, line, leading + 1, Math.max(1, rawTerm.length), source, relatedLine);
      invalid = true;
    } else if (normalized) {
      firstLineByTerm.set(normalized, line);
    }
    if (!invalid) words.push({ id: randomCourseId(), term, translations, ipa: null });
  });
  return { words, errors, nonEmptyLines };
}
