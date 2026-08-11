import type {
  AiGenerationJob,
  AiQuotaSummary,
  CreateAiExamJobRequest,
  GeneratedExamAttempt,
  GeneratedNoteDetail,
  GeneratedNoteSummary,
  SaveExamAnswersRequest,
  SubmitExamAttemptRequest,
} from "@nalanda/types";
import { apiJson } from "../../lib/api";

const json = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const materialsAiApi = {
  createJob(materialId: string, request: CreateAiExamJobRequest) {
    return apiJson<AiGenerationJob>(`/api/materials/${materialId}/ai-jobs`, json(request));
  },
  jobs() { return apiJson<AiGenerationJob[]>("/api/ai-jobs?limit=50"); },
  job(id: string) { return apiJson<AiGenerationJob>(`/api/ai-jobs/${id}`); },
  cancel(id: string) { return apiJson<AiGenerationJob>(`/api/ai-jobs/${id}/cancel`, json()); },
  quota() { return apiJson<AiQuotaSummary>("/api/profile/ai-quota"); },
  notes() { return apiJson<GeneratedNoteSummary[]>("/api/notes"); },
  note(id: string) { return apiJson<GeneratedNoteDetail>(`/api/notes/${id}`); },
  deleteNote(id: string) { return apiJson<{ deleted: true }>(`/api/notes/${id}`, { method: "DELETE" }); },
  deleteMaterial(id: string, aiResults: "keep" | "delete") {
    return apiJson<{ deleted: true }>(`/api/materials/${id}?aiResults=${aiResults}`, { method: "DELETE" });
  },
  deleteMaterialCourse(id: string, aiResults: "keep" | "delete") {
    return apiJson<{ deleted: true }>(`/api/material-courses/${id}?aiResults=${aiResults}`, { method: "DELETE" });
  },
  createAttempt(noteId: string) { return apiJson<GeneratedExamAttempt>(`/api/notes/${noteId}/exam-attempts`, json()); },
  attempts(noteId: string) { return apiJson<GeneratedExamAttempt[]>(`/api/notes/${noteId}/exam-attempts`); },
  attempt(id: string) { return apiJson<GeneratedExamAttempt>(`/api/exam-attempts/${id}`); },
  saveAnswers(id: string, request: SaveExamAnswersRequest) {
    return apiJson<GeneratedExamAttempt>(`/api/exam-attempts/${id}/answers`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
    });
  },
  submit(id: string, request: SubmitExamAttemptRequest) {
    return apiJson<GeneratedExamAttempt>(`/api/exam-attempts/${id}/submit`, json(request));
  },
  requestGrading(id: string, request: SubmitExamAttemptRequest) {
    return apiJson<GeneratedExamAttempt>(`/api/exam-attempts/${id}/grade`, json(request));
  },
};
