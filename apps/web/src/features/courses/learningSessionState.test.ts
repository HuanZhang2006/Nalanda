import { describe, expect, it } from "vitest";
import type { LearningAttemptRequest, LearningSession, VocabularyWord } from "@nalanda/types";
import { applySessionPatch, evaluateAttempt, predictAttempt } from "./learningSessionState";

const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

function word(id: string, term: string, translations: string[], position: number): VocabularyWord {
  return {
    id, term, normalizedTerm: term.toLowerCase(), translations, ipa: null, position,
    progress: {
      recognitionSeen: true,
      initialPronunciationPassed: false,
      initialTranslationPassed: false,
      initialSpellingPassed: false,
      pronunciationReviewDates: [],
      translationReviewDates: [],
      spellingReviewDates: [],
      wrongCount: 0,
      reviewCount: 0,
      learnedAt: null,
    },
  };
}

function session(stage: LearningSession["stage"]): LearningSession {
  const words = [word(ids[1], "take part in", ["参加", "参与"], 0), word(ids[2], "apple", ["苹果"], 1)];
  return {
    id: ids[0], courseId: ids[0], unitId: ids[0], mode: "initial", scope: "all",
    selectedSkills: ["pronunciation", "translation", "spelling"], stage, active: true,
    spellingOptions: { timeLimitEnabled: false, timeLimitSeconds: 20, translationFirst: false },
    spellingTranslationAssessment: null,
    revision: 0, state: { queue: words.map((entry) => entry.id), cursor: 0, nextQueue: [], round: 1 },
    items: words.map((entry, position) => ({
      word: entry, position, recognitionSeen: true,
      pronunciationPassed: stage !== "pronunciation",
      translationPassed: stage === "spelling",
      spellingPassed: false,
      wrongCount: 0,
    })),
  };
}

const request = (
  value: LearningSession,
  wordId: string,
  answer: LearningAttemptRequest["answer"],
): LearningAttemptRequest => ({
  attemptId: ids[2],
  expectedRevision: value.revision,
  wordId,
  skill: value.stage as "pronunciation" | "translation" | "spelling",
  answer,
});

describe("optimistic learning-session reducer", () => {
  it("uses the same whitespace/case and exact multi-translation rules as the server", () => {
    const target = session("translation").items[0].word;
    expect(evaluateAttempt(target, "translation", { translations: ["参与", " 参加 "] })).toBe(true);
    expect(evaluateAttempt(target, "translation", { translations: ["参加"] })).toBe(false);
    expect(evaluateAttempt(target, "spelling", { text: " TAKE   PART IN " })).toBe(true);
  });

  it("normalizes compatibility characters and accepts punctuation-only spelling differences", () => {
    const fullWidth = word(ids[2], "apple", ["苹果"], 0);
    const apostrophe = word(ids[2], "You're welcome.", ["不客气。"], 0);
    const hyphen = word(ids[2], "check-in", ["登记"], 0);
    const spaced = word(ids[2], "ice cream", ["冰淇淋"], 0);

    expect(evaluateAttempt(fullWidth, "spelling", { text: "ＡＰＰＬＥ" })).toBe(true);
    expect(evaluateAttempt(apostrophe, "spelling", { text: "YOU’RE WELCOME." })).toBe(true);
    expect(evaluateAttempt(hyphen, "spelling", { text: "CHECK‑IN" })).toBe(true);
    expect(evaluateAttempt(apostrophe, "spelling", { text: "YOURE WELCOME!" })).toBe(true);
    expect(evaluateAttempt(hyphen, "spelling", { text: "CHECK IN" })).toBe(true);
    expect(evaluateAttempt(hyphen, "spelling", { text: "CHECKIN" })).toBe(true);
    expect(evaluateAttempt(spaced, "spelling", { text: "ICE-CREAM" })).toBe(true);
    expect(evaluateAttempt(spaced, "spelling", { text: "ICECREAM!" })).toBe(false);
    expect(evaluateAttempt(fullWidth, "spelling", { text: "APPLY!" })).toBe(false);
  });

  it("adds an incorrect pronunciation target to the next-round pool and advances locally", () => {
    const value = session("pronunciation");
    const result = predictAttempt(value, request(value, ids[1], { wordId: ids[2] }));
    expect(result.result.correct).toBe(false);
    expect(result.session.revision).toBe(1);
    expect(result.session.state).toMatchObject({
      cursor: 1,
      nextQueue: [ids[1]],
      round: 1,
    });
    expect(result.session.items[0].wrongCount).toBe(1);
  });

  it("resets the full queue on a stage transition and predicts final completion", () => {
    const translation = session("translation");
    translation.items[1].translationPassed = true;
    translation.state = { queue: [ids[1]], cursor: 0, nextQueue: [], round: 2 };
    const translated = predictAttempt(
      translation,
      request(translation, ids[1], { translations: ["参加", "参与"] }),
    );
    expect(translated.session.stage).toBe("spelling");
    expect(translated.session.state).toMatchObject({
      queue: [ids[1], ids[2]], cursor: 0, nextQueue: [], round: 1,
    });

    const spelling = session("spelling");
    spelling.items[1].spellingPassed = true;
    spelling.state = { queue: [ids[1]], cursor: 0, nextQueue: [], round: 1 };
    const completed = predictAttempt(spelling, request(spelling, ids[1], { text: "take part in" }));
    expect(completed.session).toMatchObject({ stage: "completed", active: false, revision: 1 });
  });

  it("replaces provisional state with an authoritative server patch", () => {
    const value = session("translation");
    const next = applySessionPatch(value, 9, {
      stage: "translation",
      active: true,
      state: { queue: [ids[2]], cursor: 0, nextQueue: [ids[1]], round: 2 },
      changedItem: {
        wordId: ids[1], recognitionSeen: true, pronunciationPassed: true,
        translationPassed: false, spellingPassed: false, wrongCount: 3,
      },
      nextWordId: ids[2],
    });
    expect(next.revision).toBe(9);
    expect(next.items[0].wrongCount).toBe(3);
    expect(next.state).toMatchObject({ round: 2 });
  });
});
