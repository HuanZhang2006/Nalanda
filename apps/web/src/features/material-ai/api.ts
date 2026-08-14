import type {
  AiGenerationJob,
  AiJobClearResult,
  AiJobDeleteResult,
  AiMaterialCapabilities,
  AiQuotaSummary,
  CreateAiMaterialJobRequest,
  CreateKnowledgeNodeQuestionRequest,
  GeneratedExamAttempt,
  GeneratedNoteDetail,
  GeneratedNoteSummary,
  KnowledgeNodeQuestion,
  KnowledgeGraphLayout,
  SaveKnowledgeGraphLayoutRequest,
  SaveExamAnswersRequest,
  SubmitExamAttemptRequest,
} from "@nalanda/types";
import { apiJson } from "../../lib/api";

const json = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

// Materials and My Notes are intentionally English-only in this phase. Ask
// the shared transport for the server's stable English message, then let the
// feature-specific error catalog map known codes without inheriting the
// surrounding shell locale.
const materialApiJson = <T>(path: string, init: RequestInit = {}) =>
  apiJson<T>(path, init, true, false);

export const materialsAiApi = {
  createJob(materialId: string, request: CreateAiMaterialJobRequest) {
    return materialApiJson<AiGenerationJob>(`/api/materials/${materialId}/ai-jobs`, json(request));
  },
  capabilities(materialId: string) {
    return materialApiJson<AiMaterialCapabilities>(`/api/materials/${materialId}/ai-capabilities`);
  },
  jobs() { return materialApiJson<AiGenerationJob[]>("/api/ai-jobs?limit=50"); },
  job(id: string) { return materialApiJson<AiGenerationJob>(`/api/ai-jobs/${id}`); },
  cancel(id: string) { return materialApiJson<AiGenerationJob>(`/api/ai-jobs/${id}/cancel`, json()); },
  deleteJob(id: string) {
    return materialApiJson<AiJobDeleteResult>(`/api/ai-jobs/${id}`, { method: "DELETE" });
  },
  clearHistory() {
    return materialApiJson<AiJobClearResult>("/api/ai-jobs/clear-history", json());
  },
  retry(id: string) { return materialApiJson<AiGenerationJob>(`/api/ai-jobs/${id}/retry`, json()); },
  quota() { return materialApiJson<AiQuotaSummary>("/api/profile/ai-quota"); },
  notes() { return materialApiJson<GeneratedNoteSummary[]>("/api/notes"); },
  note(id: string) { return materialApiJson<GeneratedNoteDetail>(`/api/notes/${id}`); },
  graphLayout(id: string) {
    return materialApiJson<KnowledgeGraphLayout>(`/api/notes/${id}/knowledge-graph-layout`);
  },
  saveGraphLayout(id: string, request: SaveKnowledgeGraphLayoutRequest) {
    return materialApiJson<KnowledgeGraphLayout>(`/api/notes/${id}/knowledge-graph-layout`, {
      ...json(request), method: "PUT",
    });
  },
  askKnowledgeNode(noteId: string, nodeId: string, request: CreateKnowledgeNodeQuestionRequest) {
    return materialApiJson<KnowledgeNodeQuestion>(
      `/api/notes/${noteId}/knowledge-nodes/${encodeURIComponent(nodeId)}/questions`,
      json(request),
    );
  },
  knowledgeQuestion(id: string) {
    return materialApiJson<KnowledgeNodeQuestion>(`/api/knowledge-questions/${id}`);
  },
  deleteNote(id: string) { return materialApiJson<{ deleted: true }>(`/api/notes/${id}`, { method: "DELETE" }); },
  deleteMaterial(id: string, aiResults: "keep" | "delete") {
    return materialApiJson<{ deleted: true }>(`/api/materials/${id}?aiResults=${aiResults}`, { method: "DELETE" });
  },
  deleteMaterialCourse(id: string, aiResults: "keep" | "delete") {
    return materialApiJson<{ deleted: true }>(`/api/material-courses/${id}?aiResults=${aiResults}`, { method: "DELETE" });
  },
  createAttempt(noteId: string) { return materialApiJson<GeneratedExamAttempt>(`/api/notes/${noteId}/exam-attempts`, json()); },
  attempts(noteId: string) { return materialApiJson<GeneratedExamAttempt[]>(`/api/notes/${noteId}/exam-attempts`); },
  attempt(id: string) { return materialApiJson<GeneratedExamAttempt>(`/api/exam-attempts/${id}`); },
  saveAnswers(id: string, request: SaveExamAnswersRequest) {
    return materialApiJson<GeneratedExamAttempt>(`/api/exam-attempts/${id}/answers`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
    });
  },
  submit(id: string, request: SubmitExamAttemptRequest) {
    return materialApiJson<GeneratedExamAttempt>(`/api/exam-attempts/${id}/submit`, json(request));
  },
  requestGrading(id: string, request: SubmitExamAttemptRequest) {
    return materialApiJson<GeneratedExamAttempt>(`/api/exam-attempts/${id}/grade`, json(request));
  },
};
