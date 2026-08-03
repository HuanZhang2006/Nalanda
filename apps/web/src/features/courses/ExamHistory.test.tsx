import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../i18n";
import { ExamHistory } from "./ExamHistory";

const sessionId = "11111111-1111-4111-8111-111111111111";
const courseId = "22222222-2222-4222-8222-222222222222";
const unitId = "33333333-3333-4333-8333-333333333333";
const wordId = "44444444-4444-4444-8444-444444444444";
const response = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), {
  status: 200, headers: { "Content-Type": "application/json" },
}));
async function settle(work?: () => void | Promise<void>) {
  await act(async () => { await work?.(); await Promise.resolve(); await Promise.resolve(); });
}

describe("Courses exam history", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    setLocale("en", { persist: false });
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => { await settle(() => root.unmount()); vi.unstubAllGlobals(); container.remove(); });

  it("lists failed-but-remediated exams and opens owner-scoped attempt details", async () => {
    const summary = {
      id: sessionId, courseId, courseTitle: "Vocabulary", unitId, unitName: "Unit 1",
      examKind: "pronunciation", requiredPercent: 90, firstRoundAccuracyPercent: 50,
      firstRoundCorrect: 1, wordCount: 2, passed: false, practiceCompleted: true,
      status: "completed", attemptCount: 3, wrongCount: 1,
      startedAt: "2026-08-03T08:00:00.000Z", completedAt: "2026-08-03T08:04:00.000Z",
    };
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith(`/learning-exams/${sessionId}`)) return response({
        ...summary,
        words: [{ wordId, term: "apple", ipa: "ˈæpəl", translations: ["苹果"], wrongCount: 1, passed: true }],
        attempts: [{ id: "1", wordId, term: "apple", skill: "speech_assessment", correct: false,
          answer: null, pronunciationScore: 61, accuracyScore: 60, createdAt: summary.startedAt }],
      });
      return response([summary]);
    }));

    await settle(() => root.render(<ExamHistory onBack={vi.fn()} />));
    expect(container.textContent).toContain("Not passed · retries completed");
    expect(container.textContent).toContain("First round 50% / required 90%");
    const details = [...container.querySelectorAll("button")].find((button) => button.textContent === "View details")!;
    await settle(() => details.click());
    expect(container.textContent).toContain("Words in this exam");
    expect(container.textContent).toContain("apple");
    expect(container.textContent).toContain("61 / 100");
    expect(container.textContent).toContain("1 errors");
  });
});
