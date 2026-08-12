import { describe, expect, it } from "vitest";
import { parseJobRequest, parseKnowledgeQuestion, parseSaveAnswers, requestFingerprint } from "./ai.dto";

const valid = () => ({
  idempotencyKey: "11111111-1111-4111-8111-111111111111",
  kind: "exam",
  consentVersion: 1,
  settings: {
    language: "auto", difficulty: "mixed", durationMinutes: 60, totalMarks: 100,
    questionCounts: { singleChoice: 8, multipleChoice: 3, trueFalse: 4, fillBlank: 3, shortAnswer: 1, essay: 1 },
    answerDetail: "detailed", focus: "working memory",
  },
});

describe("Materials AI request validation", () => {
  it("accepts the bounded advanced settings contract and creates a stable fingerprint", () => {
    const request = parseJobRequest(valid());
    expect(request.settings.questionCounts.singleChoice).toBe(8);
    expect(requestFingerprint("22222222-2222-4222-8222-222222222222", request)).toMatch(/^[0-9a-f]{64}$/);
    expect(requestFingerprint("22222222-2222-4222-8222-222222222222", request))
      .toBe(requestFingerprint("22222222-2222-4222-8222-222222222222", parseJobRequest(valid())));
  });

  it("rejects impossible marks and out-of-range question totals", () => {
    const request = valid();
    request.settings.totalMarks = 20;
    request.settings.questionCounts.singleChoice = 100;
    expect(() => parseJobRequest(request)).toThrowError(/Review the test paper settings/);
  });

  it("accepts scalar and multiple-choice answer values but rejects duplicate question IDs", () => {
    expect(parseSaveAnswers({
      operationId: "33333333-3333-4333-8333-333333333333", expectedRevision: 4,
      answers: [{ questionId: "q1", value: 2 }, { questionId: "q2", value: [0, 3] }],
    }).answers).toHaveLength(2);
    expect(() => parseSaveAnswers({
      operationId: "33333333-3333-4333-8333-333333333333", expectedRevision: 4,
      answers: [{ questionId: "q1", value: "a" }, { questionId: "q1", value: "b" }],
    })).toThrowError(/Question IDs must be unique/);
  });

  it("accepts comprehensive knowledge maps and bounds node questions", () => {
    const request = parseJobRequest({
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      kind: "knowledge_graph",
      consentVersion: 1,
      settings: { language: "auto", detail: "comprehensive", focus: "source order" },
    });
    expect(request).toMatchObject({ kind: "knowledge_graph", settings: { detail: "comprehensive" } });
    expect(parseKnowledgeQuestion({
      idempotencyKey: "22222222-2222-4222-8222-222222222222",
      question: "  How does this connect to the prior point?  ",
    }).question).toBe("How does this connect to the prior point?");
    expect(() => parseKnowledgeQuestion({
      idempotencyKey: "22222222-2222-4222-8222-222222222222", question: "",
    })).toThrowError(/Review the knowledge point question/);
  });
});
