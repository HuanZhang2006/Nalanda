import type { ExamAnswerInput, GeneratedExamQuestionV1, GeneratedExamV1 } from "@nalanda/types";

export interface ObjectiveResult {
  questionId: string;
  awardedMarks: number | null;
  correct: boolean | null;
  feedback: string | null;
}

const normalized = (value: unknown) => String(value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
const sortedNumbers = (value: unknown) => Array.isArray(value)
  ? value.map(Number).filter(Number.isSafeInteger).sort((a, b) => a - b)
  : [];

function objective(question: GeneratedExamQuestionV1, value: ExamAnswerInput["value"]): boolean | null {
  if (question.type === "single_choice") {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) return false;
    return value === question.correctOptionIndexes[0];
  }
  if (question.type === "multiple_choice") {
    const actual = sortedNumbers(value);
    const expected = [...question.correctOptionIndexes].sort((a, b) => a - b);
    return actual.length === expected.length && actual.every((item, index) => item === expected[index]);
  }
  if (question.type === "true_false") {
    const expected = normalized(question.acceptedAnswers[0]) === "true";
    return typeof value === "boolean" && value === expected;
  }
  if (question.type === "fill_blank") {
    const actual = normalized(value);
    return Boolean(actual) && question.acceptedAnswers.some((answer) => normalized(answer) === actual);
  }
  return null;
}

export function gradeObjective(exam: GeneratedExamV1, answers: ExamAnswerInput[]) {
  const byQuestion = new Map(answers.map((answer) => [answer.questionId, answer.value]));
  const results: ObjectiveResult[] = [];
  let score = 0;
  let marks = 0;
  let needsGrading = false;
  for (const section of exam.sections) {
    for (const question of section.questions) {
      const correct = objective(question, byQuestion.get(question.id) ?? null);
      if (correct === null) {
        needsGrading = true;
        results.push({ questionId: question.id, awardedMarks: null, correct: null, feedback: null });
        continue;
      }
      marks += question.marks;
      if (correct) score += question.marks;
      results.push({
        questionId: question.id,
        awardedMarks: correct ? question.marks : 0,
        correct,
        feedback: correct ? "Correct" : "Review the answer and explanation after submission.",
      });
    }
  }
  return { results, score, marks, needsGrading };
}

export function examWithoutAnswers(exam: GeneratedExamV1) {
  return {
    ...exam,
    sections: exam.sections.map((section) => ({
      ...section,
      questions: section.questions.map(({ correctOptionIndexes: _correct, acceptedAnswers: _accepted,
        modelAnswer: _model, explanation: _explanation, rubric: _rubric, ...question }) => question),
    })),
  };
}
