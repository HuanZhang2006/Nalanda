import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  AiExamGenerationSettings,
  CreateAiExamJobRequest,
  ExamAnswerInput,
  SaveExamAnswersRequest,
  SubmitExamAttemptRequest,
} from "@nalanda/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LANGUAGES = new Set(["auto", "en", "zh"]);
const DIFFICULTIES = new Set(["introductory", "intermediate", "advanced", "mixed"]);
const ANSWER_DETAILS = new Set(["concise", "detailed"]);
const COUNT_KEYS = ["singleChoice", "multipleChoice", "trueFalse", "fillBlank", "shortAnswer", "essay"] as const;

function invalid(code: string, message: string, fieldErrors?: Record<string, string>): never {
  throw new BadRequestException({ code, message, ...(fieldErrors ? { fieldErrors } : {}) });
}

export function assertUuid(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !UUID.test(value)) invalid("INVALID_UUID", `Invalid ${field}`, { [field]: "Must be a UUID" });
  return value as string;
}

export function parseJobRequest(input: unknown): CreateAiExamJobRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("INVALID_AI_JOB", "Invalid AI job request");
  const body = input as Record<string, unknown>;
  const settings = body.settings as Record<string, unknown> | undefined;
  const counts = settings?.questionCounts as Record<string, unknown> | undefined;
  const fieldErrors: Record<string, string> = {};
  if (body.kind !== "exam") fieldErrors.kind = "Only Generate test paper is available";
  if (typeof body.idempotencyKey !== "string" || !UUID.test(body.idempotencyKey)) fieldErrors.idempotencyKey = "Must be a UUID";
  if (!Number.isSafeInteger(body.consentVersion) || Number(body.consentVersion) < 1) fieldErrors.consentVersion = "AI processing consent is required";
  if (!settings || Array.isArray(settings)) fieldErrors.settings = "Settings are required";
  if (!LANGUAGES.has(String(settings?.language))) fieldErrors["settings.language"] = "Choose auto, English, or Chinese";
  if (!DIFFICULTIES.has(String(settings?.difficulty))) fieldErrors["settings.difficulty"] = "Choose a supported difficulty";
  if (!Number.isSafeInteger(settings?.durationMinutes) || Number(settings?.durationMinutes) < 15 || Number(settings?.durationMinutes) > 240) {
    fieldErrors["settings.durationMinutes"] = "Must be between 15 and 240 minutes";
  }
  if (!Number.isSafeInteger(settings?.totalMarks) || Number(settings?.totalMarks) < 20 || Number(settings?.totalMarks) > 200) {
    fieldErrors["settings.totalMarks"] = "Must be between 20 and 200";
  }
  if (!ANSWER_DETAILS.has(String(settings?.answerDetail))) fieldErrors["settings.answerDetail"] = "Choose concise or detailed";
  if (typeof settings?.focus !== "string" || Array.from(settings.focus).length > 200) fieldErrors["settings.focus"] = "Use at most 200 characters";
  let total = 0;
  for (const key of COUNT_KEYS) {
    const value = counts?.[key];
    if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100) {
      fieldErrors[`settings.questionCounts.${key}`] = "Use a whole number from 0 to 100";
    } else total += Number(value);
  }
  if (total < 5 || total > 100) fieldErrors["settings.questionCounts"] = "Total questions must be between 5 and 100";
  if (Number.isSafeInteger(settings?.totalMarks) && Number(settings?.totalMarks) < total) {
    fieldErrors["settings.totalMarks"] = "Total marks must be at least the number of questions";
  }
  if (Object.keys(fieldErrors).length) invalid("INVALID_AI_JOB", "Review the test paper settings", fieldErrors);
  return {
    idempotencyKey: String(body.idempotencyKey),
    kind: "exam",
    consentVersion: Number(body.consentVersion),
    settings: {
      language: settings!.language as AiExamGenerationSettings["language"],
      difficulty: settings!.difficulty as AiExamGenerationSettings["difficulty"],
      durationMinutes: Number(settings!.durationMinutes),
      totalMarks: Number(settings!.totalMarks),
      questionCounts: Object.fromEntries(COUNT_KEYS.map((key) => [key, Number(counts![key])])) as unknown as AiExamGenerationSettings["questionCounts"],
      answerDetail: settings!.answerDetail as AiExamGenerationSettings["answerDetail"],
      focus: String(settings!.focus).trim(),
    },
  };
}

export function requestFingerprint(materialId: string, request: CreateAiExamJobRequest) {
  return createHash("sha256").update(JSON.stringify({ materialId, kind: request.kind, settings: request.settings })).digest("hex");
}

export function parseSaveAnswers(input: unknown): SaveExamAnswersRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("INVALID_EXAM_ANSWERS", "Invalid answer update");
  const body = input as Record<string, unknown>;
  assertUuid(body.operationId, "operationId");
  if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) invalid("INVALID_REVISION", "Invalid exam revision");
  if (!Array.isArray(body.answers) || body.answers.length > 100) invalid("INVALID_EXAM_ANSWERS", "Answers must be an array of at most 100 items");
  const seen = new Set<string>();
  const answers = body.answers.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) invalid("INVALID_EXAM_ANSWERS", "Invalid answer item");
    const answer = raw as Record<string, unknown>;
    const questionId = String(answer.questionId || "");
    if (!questionId || questionId.length > 80 || seen.has(questionId)) invalid("INVALID_EXAM_ANSWERS", "Question IDs must be unique");
    seen.add(questionId);
    const value = answer.value;
    if (!(value === null || typeof value === "string" || typeof value === "boolean" || Number.isSafeInteger(value)
        || Array.isArray(value) && value.length <= 50 && value.every((item) => typeof item === "string" || Number.isSafeInteger(item)))) {
      invalid("INVALID_EXAM_ANSWERS", "Unsupported answer value");
    }
    if (typeof value === "string" && Array.from(value).length > 10_000) invalid("INVALID_EXAM_ANSWERS", "An answer is too long");
    return { questionId, value } as ExamAnswerInput;
  });
  return { operationId: String(body.operationId), expectedRevision: Number(body.expectedRevision), answers };
}

export function parseSubmit(input: unknown): SubmitExamAttemptRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) invalid("INVALID_EXAM_SUBMISSION", "Invalid exam submission");
  const body = input as Record<string, unknown>;
  assertUuid(body.operationId, "operationId");
  if (!Number.isSafeInteger(body.expectedRevision) || Number(body.expectedRevision) < 0) invalid("INVALID_REVISION", "Invalid exam revision");
  return { operationId: String(body.operationId), expectedRevision: Number(body.expectedRevision) };
}
