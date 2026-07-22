import { describe, expect, it } from "vitest";
import { parseMultiUnitVocabularyText, parseVocabularyText } from "./parser";

describe("英语词表解析器", () => {
  it("按最后一个 ASCII 空格解析单词、短语和多个翻译", () => {
    const result = parseVocabularyText("apple 苹果\ntake part in 参加/参与\n\nwell-being 健康");
    expect(result.errors).toEqual([]);
    expect(result.words.map(({ term, translations }) => ({ term, translations }))).toEqual([
      { term: "apple", translations: ["苹果"] },
      { term: "take part in", translations: ["参加", "参与"] },
      { term: "well-being", translations: ["健康"] },
    ]);
  });

  it("报告精确行列和稳定错误码", () => {
    const result = parseVocabularyText("apple\npear 梨//香梨\norange ");
    expect(result.errors.map(({ code, line, column }) => ({ code, line, column }))).toEqual([
      { code: "MISSING_SEPARATOR", line: 1, column: 6 },
      { code: "CONTINUOUS_TRANSLATION_SEPARATOR", line: 2, column: 7 },
      { code: "EMPTY_TRANSLATION", line: 2, column: 8 },
      { code: "EMPTY_TRANSLATION", line: 3, column: 8 },
    ]);
  });

  it("拒绝同单元重复、非法 Unicode 英文和 XSS 英文，但把翻译当纯文本保留", () => {
    const result = parseVocabularyText("café 咖啡\nword <img src=x>\nApple 苹果\n apple 水果");
    expect(result.errors.some((entry) => entry.code === "INVALID_ENGLISH" && entry.line === 1)).toBe(true);
    expect(result.errors.some((entry) => entry.code === "INVALID_ENGLISH" && entry.line === 2)).toBe(true);
    expect(result.errors.some((entry) => entry.code === "DUPLICATE_TERM" && entry.relatedLine === 3)).toBe(true);
    expect(result.words[0]?.translations).toEqual(["苹果"]);
  });

  it("覆盖翻译数量与长度限制", () => {
    const many = Array.from({ length: 11 }, (_, i) => `义${i}`).join("/");
    const result = parseVocabularyText(`term ${many}\nlong ${"译".repeat(121)}\nrepeat 释义/释义`);
    expect(result.errors.map((entry) => entry.code)).toContain("TOO_MANY_TRANSLATIONS");
    expect(result.errors.map((entry) => entry.code)).toContain("TRANSLATION_TOO_LONG");
    expect(result.errors).toContainEqual(expect.objectContaining({
      code: "DUPLICATE_TRANSLATION", line: 3, column: 11, length: 2,
    }));
  });

  it("覆盖英文长度、空行忽略和 CRLF 规范化", () => {
    const result = parseVocabularyText(`\r\n${"a".repeat(121)} 翻译\r\nvalid 有效\r\n`);
    expect(result.nonEmptyLines).toBe(2);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "TERM_TOO_LONG", line: 2, column: 121 }),
    ]));
    expect(result.words.map((word) => word.term)).toEqual(["valid"]);
  });

  it("从一整份文本识别编号单元标题并保留短语和独立翻译", () => {
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

  it("支持显式自定义单元标题并按整份文本行号报告错误", () => {
    const result = parseMultiUnitVocabularyText("[Travel words]\napple 苹果\nbroken\n# Useful phrases\ntake part in 参加/参与");
    expect(result.units.map((unit) => unit.name)).toEqual(["Travel words", "Useful phrases"]);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "MISSING_SEPARATOR", line: 3, column: 7, source: "broken" }));
  });

  it("拒绝缺少单元标题的整表，并识别与已有单元词条的重复", () => {
    expect(parseMultiUnitVocabularyText("apple 苹果\npear 梨").errors).toContainEqual(expect.objectContaining({
      code: "MISSING_UNIT_HEADER", line: 1,
    }));
    expect(parseVocabularyText("apple 水果\npear 梨", { existingTerms: [" Apple "] }).errors).toContainEqual(expect.objectContaining({
      code: "DUPLICATE_EXISTING_TERM", line: 1,
    }));
  });
});
