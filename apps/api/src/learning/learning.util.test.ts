import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { contentFingerprint, publicSnapshot, validateCourseInput } from "./learning.util";

const ids = [
  "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];

function course() {
  return { id: ids[0], title: "Vocabulary", category: "english_vocabulary", hasUnits: false, locale: "en-US",
    units: [{ id: ids[1], name: "默认单元", isSystem: true, words: ["Apple", "take part in", "well-being", "can't"].map((term, index) => ({
      id: ids[index + 1], term, translations: [`翻译${index}`], ipa: null,
    })) }] };
}

describe("learning payload boundary", () => {
  it("normalizes a valid course and keeps phrases", () => {
    const value = validateCourseInput(course());
    expect(value.units[0].words[1].term).toBe("take part in");
    expect(value.units[0].words).toHaveLength(4);
  });

  it("rejects duplicate ids, duplicate translations, invalid terms, and non-boolean unit mode", () => {
    const value: any = course(); value.hasUnits = "false"; value.units[0].words[1].id = value.units[0].words[0].id;
    value.units[0].words[2].translations = ["相同", "相同"]; value.units[0].words[3].term = "<script>";
    try { validateCourseInput(value); throw new Error("expected rejection"); }
    catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as any;
      expect(response.fieldErrors.hasUnits).toBeTruthy();
      expect(response.fieldErrors["units.0.words.1.id"]).toBeTruthy();
      expect(response.fieldErrors["units.0.words.2.translations"]).toBeTruthy();
      expect(response.fieldErrors["units.0.words.3.term"]).toBeTruthy();
    }
  });

  it("enforces course, unit, word, translation, and text limits", () => {
    const tooManyWords: any = course();
    tooManyWords.units[0].words = Array.from({ length: 2_001 }, (_, index) => ({
      id: randomUUID(), term: `word-${index}`, translations: ["翻译"], ipa: null,
    }));
    expect(() => validateCourseInput(tooManyWords)).toThrow(BadRequestException);

    const tooManyUnits: any = course();
    tooManyUnits.hasUnits = true;
    tooManyUnits.units = Array.from({ length: 101 }, (_, index) => ({
      id: randomUUID(), name: `Unit ${index + 1}`, isSystem: false,
      words: [{ id: randomUUID(), term: `word-${index}`, translations: ["翻译"] }],
    }));
    expect(() => validateCourseInput(tooManyUnits)).toThrow(BadRequestException);

    const textLimits: any = course();
    textLimits.units[0].words[0].term = "a".repeat(121);
    textLimits.units[0].words[1].translations = Array.from({ length: 11 }, (_, index) => `翻译${index}`);
    textLimits.units[0].words[2].ipa = "x".repeat(121);
    expect(() => validateCourseInput(textLimits)).toThrow(BadRequestException);
  });

  it("uses a sorted distinct term fingerprint and strips private fields from public snapshots", () => {
    const a = { title: "x", hasUnits: false, units: [{ name: "u", position: 0, words: [
      { id: "private", term: "Beta", translations: ["乙"], ipa: null, progress: { wrongCount: 9 } },
      { term: "alpha", translations: ["甲"], ipa: "/a/" }, { term: "ALPHA", translations: ["重复"], ipa: null },
    ] }] };
    const b = { ...a, units: [{ ...a.units[0], words: [...a.units[0].words].reverse() }] };
    expect(contentFingerprint(a)).toBe(contentFingerprint(b));
    const snapshot = publicSnapshot(a) as any;
    expect(snapshot.units[0].words[0].id).toBeUndefined();
    expect(snapshot.units[0].words[0].progress).toBeUndefined();
  });
});
