import { describe, expect, it } from "vitest";
import { parseMultiUnitVocabularyText, parseVocabularyText } from "./parser";

describe("English vocabulary parser", () => {
  it("splits words, phrases, and multiple translations on the last ASCII space", () => {
    const result = parseVocabularyText("apple 苹果\ntake part in 参加/参与\n\nwell-being 健康");
    expect(result.errors).toEqual([]);
    expect(result.words.map(({ term, translations }) => ({ term, translations }))).toEqual([
      { term: "apple", translations: ["苹果"] },
      { term: "take part in", translations: ["参加", "参与"] },
      { term: "well-being", translations: ["健康"] },
    ]);
  });

  it("reports exact line/column positions and stable error codes", () => {
    const result = parseVocabularyText("apple\npear 梨//香梨\norange ");
    expect(result.errors.map(({ code, line, column }) => ({ code, line, column }))).toEqual([
      { code: "MISSING_SEPARATOR", line: 1, column: 6 },
      { code: "CONTINUOUS_TRANSLATION_SEPARATOR", line: 2, column: 7 },
      { code: "EMPTY_TRANSLATION", line: 2, column: 8 },
      { code: "EMPTY_TRANSLATION", line: 3, column: 8 },
    ]);
  });

  it("rejects same-unit duplicates, invalid Unicode English, and XSS English, but keeps translations as plain text", () => {
    const result = parseVocabularyText("café 咖啡\nword <img src=x>\nApple 苹果\n apple 水果");
    expect(result.errors.some((entry) => entry.code === "INVALID_ENGLISH" && entry.line === 1)).toBe(true);
    expect(result.errors.some((entry) => entry.code === "INVALID_ENGLISH" && entry.line === 2)).toBe(true);
    expect(result.errors.some((entry) => entry.code === "DUPLICATE_TERM" && entry.relatedLine === 3)).toBe(true);
    expect(result.words[0]?.translations).toEqual(["苹果"]);
  });

  it("covers translation count and length limits", () => {
    const many = Array.from({ length: 11 }, (_, i) => `义${i}`).join("/");
    const result = parseVocabularyText(`term ${many}\nlong ${"译".repeat(121)}\nrepeat 释义/释义`);
    expect(result.errors.map((entry) => entry.code)).toContain("TOO_MANY_TRANSLATIONS");
    expect(result.errors.map((entry) => entry.code)).toContain("TRANSLATION_TOO_LONG");
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "DUPLICATE_TRANSLATION", line: 3, column: 11, length: 2,
    }));
  });

  it("covers English length, ignored blank lines, and CRLF normalization", () => {
    const result = parseVocabularyText(`\r\n${"a".repeat(121)} 翻译\r\nvalid 有效\r\n`);
    expect(result.nonEmptyLines).toBe(2);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "TERM_TOO_LONG", line: 2, column: 121 }),
    ]));
    expect(result.words.map((word) => word.term)).toEqual(["valid"]);
  });

  it("recognizes numbered unit headings in one document and keeps phrases and separate translations", () => {
    const result = parseMultiUnitVocabularyText(`Starter Unit 1
unit 单元
section 部分
other 另外的/其他的
each other 互相/彼此
Starter Unit 2
bottle 瓶子
You're welcome. 不客气。
key 钥匙/关键`);
    expect(result.errors).toEqual([]);
    expect(result.units.map((unit) => unit.name)).toEqual(["Starter Unit 1", "Starter Unit 2"]);
    expect(result.units[0].words).toEqual(expect.arrayContaining([
      expect.objectContaining({ term: "other", translations: ["另外的", "其他的"] }),
      expect.objectContaining({ term: "each other", translations: ["互相", "彼此"] }),
    ]));
    expect(result.units[1].words).toEqual(expect.arrayContaining([
      expect.objectContaining({ term: "You're welcome.", translations: ["不客气。"] }),
    ]));
  });

  it("supports explicit custom unit headings and reports errors by document line number", () => {
    const result = parseMultiUnitVocabularyText("[Travel words]\napple 苹果\nbroken\n# Useful phrases\ntake part in 参加/参与");
    expect(result.units.map((unit) => unit.name)).toEqual(["Travel words", "Useful phrases"]);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "MISSING_SEPARATOR", line: 3, column: 7, source: "broken" }));
  });

  it("rejects a document without unit headings and detects duplicates of existing unit terms", () => {
    expect(parseMultiUnitVocabularyText("apple 苹果\npear 梨").errors).toContainEqual(expect.objectContaining({
      code: "MISSING_UNIT_HEADER", line: 1,
    }));
    expect(parseVocabularyText("apple 水果\npear 梨", { existingTerms: [" Apple "] }).errors).toContainEqual(expect.objectContaining({
      code: "DUPLICATE_EXISTING_TERM", line: 1,
    }));
  });
});
