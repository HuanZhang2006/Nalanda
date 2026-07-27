import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LearningCourseDetail, LearningSession, VocabularyWord } from "@nalanda/types";
import { setLocale } from "../../i18n";
import { beginWavRecording } from "./recording";
import { LearningView } from "./LearningView";

vi.mock("./recording", () => ({ beginWavRecording: vi.fn() }));

const ids = [
  "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];
const progress = { recognitionSeen: false, initialPronunciationPassed: false, initialTranslationPassed: false, initialSpellingPassed: false,
  pronunciationReviewDates: [], translationReviewDates: [], spellingReviewDates: [], wrongCount: 0, reviewCount: 0, learnedAt: null };

function word(id: string, term: string, translations: string[], position: number): VocabularyWord {
  return { id, term, normalizedTerm: term.toLowerCase(), translations, ipa: null, position, progress };
}

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
}));

async function settle(work?: () => void | Promise<void>) {
  await act(async () => {
    await work?.();
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

function click(element: Element) { element.dispatchEvent(new MouseEvent("click", { bubbles: true })); }

function inputValue(element: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function course(words: VocabularyWord[]): LearningCourseDetail {
  return { id: ids[0], title: "Instant feedback", category: "english_vocabulary", hasUnits: false, locale: "en-US",
    unitCount: 1, wordCount: words.length, learnedCount: 0, progressPercent: 0, activeSessionId: ids[4], canRepublish: true,
    originPublicationId: null, originShareId: null, originAuthorName: null, updatedAt: new Date(0).toISOString(),
    units: [{ id: ids[1], name: "Default unit", position: 0, isSystem: true, words }] };
}

function session(words: VocabularyWord[], stage: LearningSession["stage"], cursor: number, nextQueue: string[] = []): LearningSession {
  return { id: ids[4], courseId: ids[0], unitId: ids[1], mode: "initial", scope: "all",
    selectedSkills: ["pronunciation", "translation", "spelling"], stage, active: true, revision: cursor,
    state: { queue: words.map((entry) => entry.id), cursor, nextQueue, round: 1 },
    items: words.map((entry, position) => ({ word: entry, position, recognitionSeen: stage !== "recognition",
      pronunciationPassed: false, translationPassed: false, spellingPassed: false, wrongCount: 0 })) };
}

function installApi(words: VocabularyWord[], stage: LearningSession["stage"], options: {
  assessment?: "low" | "high";
  holdAttempt?: boolean;
  serverCorrect?: boolean;
} = {}) {
  let cursor = 0;
  let revision = 0;
  let retryQueue: string[] = [];
  const attempts: Array<Record<string, unknown>> = [];
  let releaseAttempt: (() => void) | null = null;
  const fetchMock = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input);
    if (path.endsWith(`/api/learning-courses/${ids[0]}`)) return json(course(words));
    if (path.endsWith(`/api/learning-sessions/${ids[4]}/attempts`)) {
      const request = JSON.parse(String(init.body)) as {
        attemptId: string; expectedRevision: number; wordId: string; skill: string; answer: Record<string, unknown>;
      };
      attempts.push(request);
      const current = words[cursor];
      const predictedCorrect = request.skill === "pronunciation"
        ? request.answer.wordId === request.wordId
        : request.skill === "translation"
          ? JSON.stringify([...(request.answer.translations as string[])].sort()) === JSON.stringify([...current.translations].sort())
          : String(request.answer.text).toLowerCase() === current.term.toLowerCase();
      const correct = options.serverCorrect ?? predictedCorrect;
      cursor = Math.min(cursor + 1, words.length - 1);
      revision += 1;
      const next = session(words, stage, cursor, retryQueue);
      next.revision = revision;
      const responseBody = {
        attemptId: request.attemptId,
        correct,
        expected: request.skill === "translation" ? current.translations : current.term,
        revision,
        replayed: false,
        sessionPatch: {
          stage, active: true, state: next.state,
          changedItem: {
            wordId: request.wordId,
            recognitionSeen: true,
            pronunciationPassed: request.skill === "pronunciation" && correct,
            translationPassed: request.skill === "translation" && correct,
            spellingPassed: request.skill === "spelling" && correct,
            wrongCount: correct ? 0 : 1,
          },
          nextWordId: words[cursor]?.id || null,
        },
      };
      if (options.holdAttempt) {
        return new Promise<Response>((resolve) => {
          releaseAttempt = () => { void json(responseBody).then(resolve); };
        });
      }
      return json(responseBody);
    }
    if (path.includes("/api/learning-units/") && (
      path.endsWith("/audio-prewarm") || path.endsWith("/audio-manifest")
    )) return json({
      unitId: ids[1], total: words.length, ready: words.length, pending: 0, failed: 0,
      synthesisVersion: "1",
      assets: words.map((entry) => ({
        wordId: entry.id, cacheKey: entry.id, status: "ready",
        audioUrl: `/api/pronunciation/audio/${entry.id}`, lastErrorCode: null,
      })),
    });
    if (path.endsWith("/api/pronunciation/assess")) {
      const low = options.assessment !== "high";
      retryQueue = low ? [words[0].id] : [];
      return json({ accuracyScore: low ? 64 : 88, fluencyScore: 80, completenessScore: 100,
        pronunciationScore: low ? 66 : 90, passThreshold: 70, passed: !low, queuedForRetry: low,
        revision: ++revision,
        sessionPatch: {
          stage: "recognition", active: true,
          state: session(words, "recognition", cursor, retryQueue).state,
          changedItem: null, nextWordId: words[cursor].id,
        },
        errorType: null, phonemes: [{ phoneme: "æ", accuracyScore: low ? 62 : 91, needsPractice: low }] }, 201);
    }
    if (path.includes("/api/pronunciation/audio/")) return Promise.resolve(new Response(new Blob(["audio"], { type: "audio/mpeg" }), { status: 200 }));
    if (path.endsWith(`/api/learning-sessions/${ids[4]}`)) return json(session(words, stage, cursor, retryQueue));
    throw new Error(`Unexpected fetch: ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { attempts, fetchMock, releaseAttempt: () => releaseAttempt?.() };
}

describe("LearningView immediate feedback", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    setLocale("en", { persist: false });
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
    vi.stubGlobal("Audio", class {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      play = vi.fn().mockResolvedValue(undefined);
    });
    if (!(URL as typeof URL & { createObjectURL?: unknown }).createObjectURL) {
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    }
  });

  afterEach(async () => { await settle(() => root.unmount()); vi.unstubAllGlobals(); vi.mocked(beginWavRecording).mockReset(); });

  it("keeps incorrect translation feedback visible until the user opens the next question", async () => {
    vi.useFakeTimers();
    const words = [word(ids[2], "apple", ["苹果"], 0), word(ids[3], "banana", ["香蕉"], 1)];
    const { attempts } = installApi(words, "translation");
    await settle(() => root.render(<LearningView sessionId={ids[4]} onExit={() => {}} onChanged={() => {}} />));

    expect(container.textContent).not.toContain("Check answer");
    await settle(() => click([...container.querySelectorAll("button")].find((entry) => entry.textContent === "香蕉")!));
    expect(attempts).toHaveLength(1);
    expect(container.querySelector(".course-option.is-wrong")?.textContent).toBe("香蕉");
    expect(container.textContent).toContain("added to the next-round retry pool");
    const nextQuestion = [...container.querySelectorAll("button")].find((entry) => entry.textContent === "Next question");
    expect(nextQuestion).toBeTruthy();
    expect(document.activeElement).toBe(nextQuestion);

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(container.querySelector(".course-term")?.textContent).toBe("apple");
    expect(container.querySelector(".course-option.is-wrong")?.textContent).toBe("香蕉");
    expect(container.textContent).toContain("added to the next-round retry pool");

    await settle(() => click(nextQuestion!));
    expect(container.querySelector(".course-term")?.textContent).toBe("banana");
    expect(container.textContent).not.toContain("added to the next-round retry pool");
  });

  it("renders provisional feedback before the answer request resolves", async () => {
    const words = [word(ids[2], "apple", ["苹果"], 0), word(ids[3], "banana", ["香蕉"], 1)];
    const api = installApi(words, "translation", { holdAttempt: true });
    await settle(() => root.render(<LearningView sessionId={ids[4]} onExit={() => {}} onChanged={() => {}} />));

    await settle(() => click([...container.querySelectorAll("button")].find((entry) => entry.textContent === "香蕉")!));
    expect(api.attempts).toHaveLength(1);
    expect(container.querySelector(".course-option.is-wrong")?.textContent).toBe("香蕉");
    expect(container.textContent).toContain("added to the next-round retry pool");
    api.releaseAttempt();
    await settle();
  });

  it("continues serial outbox sync when a later answer was queued during a slow request", async () => {
    vi.useFakeTimers();
    const words = [word(ids[2], "apple", ["苹果"], 0), word(ids[3], "banana", ["香蕉"], 1)];
    const api = installApi(words, "translation", { holdAttempt: true });
    await settle(() => root.render(<LearningView sessionId={ids[4]} onExit={() => {}} onChanged={() => {}} />));

    await settle(() => click([...container.querySelectorAll("button")].find((entry) => entry.textContent === "苹果")!));
    expect(api.attempts).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(520); });
    expect(container.querySelector(".course-term")?.textContent).toBe("banana");

    await settle(() => click([...container.querySelectorAll("button")].find((entry) => entry.textContent === "香蕉")!));
    expect(api.attempts).toHaveLength(1);
    api.releaseAttempt();
    await settle();
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await settle();
    expect(api.attempts).toHaveLength(2);
    expect(api.attempts.map((entry) => entry.expectedRevision)).toEqual([0, 1]);
  });

  it("keeps a server-corrected error visible instead of running the provisional success timer", async () => {
    vi.useFakeTimers();
    const words = [word(ids[2], "apple", ["苹果"], 0), word(ids[3], "banana", ["香蕉"], 1)];
    const api = installApi(words, "translation", { holdAttempt: true, serverCorrect: false });
    await settle(() => root.render(<LearningView sessionId={ids[4]} onExit={() => {}} onChanged={() => {}} />));

    await settle(() => click([...container.querySelectorAll("button")].find((entry) => entry.textContent === "苹果")!));
    expect(container.textContent).toContain("Correct — continuing");
    api.releaseAttempt();
    await settle();
    expect(container.textContent).toContain("Incorrect — added to the next-round retry pool");
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(container.querySelector(".course-term")?.textContent).toBe("apple");
    expect(container.textContent).toContain("Next question");
  });

  it("auto-advances when the server corrects a provisional error", async () => {
    vi.useFakeTimers();
    const words = [word(ids[2], "apple", ["苹果"], 0), word(ids[3], "banana", ["香蕉"], 1)];
    const api = installApi(words, "translation", { holdAttempt: true, serverCorrect: true });
    await settle(() => root.render(<LearningView sessionId={ids[4]} onExit={() => {}} onChanged={() => {}} />));

    await settle(() => click([...container.querySelectorAll("button")].find((entry) => entry.textContent === "香蕉")!));
    expect(container.textContent).toContain("Incorrect — added to the next-round retry pool");
    api.releaseAttempt();
    await settle();
    expect(container.textContent).toContain("Correct — continuing");
    await act(async () => { await vi.advanceTimersByTimeAsync(520); });
    expect(container.querySelector(".course-term")?.textContent).toBe("banana");
  });

  it("collects only the required multi-select answers and auto-submits the final correct choice", async () => {
    vi.useFakeTimers();
    const words = [word(ids[2], "other", ["另外的", "其他的"], 0), word(ids[3], "unit", ["单元"], 1)];
    const { attempts } = installApi(words, "translation");
    await settle(() => root.render(<LearningView sessionId={ids[4]} onExit={() => {}} onChanged={() => {}} />));

    await settle(() => click([...container.querySelectorAll("button")].find((entry) => entry.textContent === "另外的")!));
    expect(attempts).toHaveLength(0);
    expect(container.querySelector(".course-option.picked-correct")?.textContent).toBe("另外的");
    await settle(() => click([...container.querySelectorAll("button")].find((entry) => entry.textContent === "其他的")!));
    expect(attempts).toHaveLength(1);
    expect(container.querySelector(".course-option.is-correct")?.textContent).toBe("其他的");
    expect(container.textContent).toContain("Correct — continuing");
  });

  it("submits a pronunciation match as soon as the word is selected", async () => {
    vi.useFakeTimers();
    const words = [word(ids[2], "apple", ["苹果"], 0), word(ids[3], "banana", ["香蕉"], 1)];
    const { attempts } = installApi(words, "pronunciation");
    await settle(() => root.render(<LearningView sessionId={ids[4]} onExit={() => {}} onChanged={() => {}} />));

    await settle(() => click(container.querySelector('[aria-label="Play apple"]')!));
    await settle(() => click([...container.querySelectorAll(".course-match > div:nth-child(2) button")].find((entry) => entry.textContent === "apple")!));
    expect(attempts).toHaveLength(1);
    expect(container.querySelector(".course-match button.is-correct")).not.toBeNull();
    expect(container.textContent).not.toContain("Continue");
  });

  it("keeps an incorrect pronunciation match visible until Next question", async () => {
    vi.useFakeTimers();
    const words = [word(ids[2], "apple", ["苹果"], 0), word(ids[3], "banana", ["香蕉"], 1)];
    const { attempts } = installApi(words, "pronunciation");
    await settle(() => root.render(<LearningView sessionId={ids[4]} onExit={() => {}} onChanged={() => {}} />));

    await settle(() => click(container.querySelector('[aria-label="Play apple"]')!));
    await settle(() => click([...container.querySelectorAll(".course-match > div:nth-child(2) button")].find((entry) => entry.textContent === "banana")!));
    expect(attempts).toHaveLength(1);
    expect(container.querySelector(".course-match button.is-wrong")).not.toBeNull();
    expect(container.textContent).toContain("Correct answer: apple");

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(container.querySelector(".course-match button.is-wrong")).not.toBeNull();
    expect(container.textContent).toContain("Correct answer: apple");

    await settle(() => click([...container.querySelectorAll("button")].find((entry) => entry.textContent === "Next question")!));
    expect(container.textContent).not.toContain("Correct answer: apple");
  });

  it("keeps an incorrect spelling diff visible until Next question", async () => {
    vi.useFakeTimers();
    const words = [word(ids[2], "apple", ["苹果"], 0), word(ids[3], "banana", ["香蕉"], 1)];
    const { attempts } = installApi(words, "spelling");
    await settle(() => root.render(<LearningView sessionId={ids[4]} onExit={() => {}} onChanged={() => {}} />));

    const spelling = container.querySelector<HTMLInputElement>('[aria-label="Spelling answer"]')!;
    await settle(() => inputValue(spelling, "apply"));
    await settle(() => { spelling.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(attempts).toHaveLength(1);
    expect(container.querySelector(".course-spelling-answer.is-wrong")).not.toBeNull();
    expect(container.textContent).toContain("Correct spelling: apple");

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(container.querySelector(".course-spelling-answer.is-wrong")).not.toBeNull();
    expect(container.textContent).toContain("Correct spelling: apple");

    await settle(() => click([...container.querySelectorAll("button")].find((entry) => entry.textContent === "Next question")!));
    expect(container.querySelector<HTMLInputElement>('[aria-label="Spelling answer"]')?.value).toBe("");
    expect(container.textContent).not.toContain("Correct spelling: apple");
  });

  it("shows the pronunciation pass score, persisted retry status, and an explicit read-again action", async () => {
    const words = [word(ids[2], "apple", ["苹果"], 0), word(ids[3], "banana", ["香蕉"], 1)];
    installApi(words, "recognition", { assessment: "low" });
    vi.mocked(beginWavRecording).mockResolvedValue(async () => new Blob(["wav"], { type: "audio/wav" }));
    await settle(() => root.render(<LearningView sessionId={ids[4]} onExit={() => {}} onChanged={() => {}} />));

    await settle(() => click([...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes("Pronunciation feedback"))!));
    await settle(() => click([...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes("Stop and assess"))!));
    expect(container.textContent).toContain("Pass score: 70 or higher");
    expect(container.textContent).toContain("added to the recognition retry pool");
    const retry = [...container.querySelectorAll("button")].find((entry) => entry.textContent?.includes("Try pronunciation again"));
    expect(retry).toBeTruthy();

    await settle(() => click(retry!));
    expect(vi.mocked(beginWavRecording)).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Stop and assess");
  });
});
