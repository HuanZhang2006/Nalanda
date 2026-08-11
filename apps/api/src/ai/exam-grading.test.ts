import { describe, expect, it } from "vitest";
import type { GeneratedExamV1 } from "@nalanda/types";
import { examWithoutAnswers, gradeObjective } from "./exam-grading";

const exam: GeneratedExamV1 = {
  schemaVersion: "generated-exam.v1", title: "Test", language: "en", difficulty: "mixed",
  durationMinutes: 60, totalMarks: 10, instructions: [], sections: [{ id: "s1", title: "Section", instructions: "", questions: [
    { id: "single", type: "single_choice", prompt: "One", marks: 2, options: ["a", "b"], correctOptionIndexes: [1], acceptedAnswers: [], modelAnswer: "b", explanation: "", rubric: [], sourceRefs: [{ blockId: "b1", page: 1, slide: null, label: "p1" }] },
    { id: "multi", type: "multiple_choice", prompt: "Many", marks: 2, options: ["a", "b", "c"], correctOptionIndexes: [0, 2], acceptedAnswers: [], modelAnswer: "a,c", explanation: "", rubric: [], sourceRefs: [{ blockId: "b1", page: 1, slide: null, label: "p1" }] },
    { id: "fill", type: "fill_blank", prompt: "Fill", marks: 2, options: [], correctOptionIndexes: [], acceptedAnswers: ["Working memory"], modelAnswer: "Working memory", explanation: "", rubric: [], sourceRefs: [{ blockId: "b1", page: 1, slide: null, label: "p1" }] },
    { id: "short", type: "short_answer", prompt: "Explain", marks: 4, options: [], correctOptionIndexes: [], acceptedAnswers: [], modelAnswer: "Answer", explanation: "", rubric: ["Concept"], sourceRefs: [{ blockId: "b1", page: 1, slide: null, label: "p1" }] },
  ] }],
};

describe("server-side objective grading", () => {
  it("grades objective types deterministically and leaves subjective marks to AI", () => {
    const result = gradeObjective(exam, [
      { questionId: "single", value: 1 }, { questionId: "multi", value: [2, 0] },
      { questionId: "fill", value: "  WORKING   MEMORY " }, { questionId: "short", value: "draft" },
    ]);
    expect(result).toMatchObject({ score: 6, marks: 6, needsGrading: true });
    expect(result.results.find((item) => item.questionId === "short")?.awardedMarks).toBeNull();
  });

  it("removes every answer, explanation, and rubric from the learner session", () => {
    const hidden = examWithoutAnswers(exam);
    expect(hidden.sections[0].questions[0]).not.toHaveProperty("correctOptionIndexes");
    expect(hidden.sections[0].questions[0]).not.toHaveProperty("modelAnswer");
    expect(JSON.stringify(hidden)).not.toContain("Working memory");
  });

  it("never treats an unanswered single-choice question as option zero", () => {
    const result = gradeObjective(exam, []);
    const single = result.results.find((item) => item.questionId === "single");
    expect(single).toMatchObject({ correct: false, awardedMarks: 0 });
  });
});
