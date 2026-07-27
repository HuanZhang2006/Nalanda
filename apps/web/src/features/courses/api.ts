import type {
  CreateCourseReportRequest, LearningAttemptRequest, LearningAttemptResult, LearningAudioManifest, LearningCourseDetail,
  LearningCourseInput, LearningCourseSummary, LearningProfileSummary, LearningSession,
  LearningSessionMutationResult, PublicCoursePreview, ReviewSchedule, StartLearningSessionRequest,
} from "@nalanda/types";
import { apiJson } from "../../lib/api";

const json = (body: unknown): RequestInit => ({
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

export const coursesApi = {
  list: () => apiJson<LearningCourseSummary[]>("/api/learning-courses"),
  detail: (id: string) => apiJson<LearningCourseDetail>(`/api/learning-courses/${id}`),
  save: (course: LearningCourseInput, existing = false) => apiJson<LearningCourseDetail>(
    existing ? `/api/learning-courses/${course.id}` : "/api/learning-courses",
    { ...json(course), method: existing ? "PUT" : "POST" },
  ),
  rename: (id: string, title: string) => apiJson<LearningCourseDetail>(`/api/learning-courses/${id}`, {
    ...json({ title }), method: "PATCH",
  }),
  remove: (id: string) => apiJson<{ ok: true }>(`/api/learning-courses/${id}`, { method: "DELETE" }),
  startSession: (courseId: string, body: StartLearningSessionRequest) => apiJson<LearningSession>(`/api/learning-courses/${courseId}/sessions`, json(body)),
  session: (id: string) => apiJson<LearningSession>(`/api/learning-sessions/${id}`),
  recognition: (id: string, wordId: string) => apiJson<LearningSessionMutationResult>(`/api/learning-sessions/${id}/recognition`, json({ wordId })),
  attempt: (id: string, body: LearningAttemptRequest, signal?: AbortSignal) => apiJson<LearningAttemptResult>(
    `/api/learning-sessions/${id}/attempts`,
    { ...json(body), signal },
  ),
  prewarmAudio: (unitId: string) => apiJson<LearningAudioManifest>(`/api/learning-units/${unitId}/audio-prewarm`, json({})),
  audioManifest: (unitId: string) => apiJson<LearningAudioManifest>(`/api/learning-units/${unitId}/audio-manifest`),
  schedules: () => apiJson<ReviewSchedule[]>("/api/learning-review-schedules"),
  schedule: (unitId: string, sourceSessionId: string, offsets: number[]) => apiJson<ReviewSchedule[]>(`/api/learning-units/${unitId}/review-schedules`, json({ sourceSessionId, offsets })),
  cancelSchedule: (id: string) => apiJson<{ ok: true }>(`/api/learning-review-schedules/${id}`, { method: "DELETE" }),
  profile: () => apiJson<LearningProfileSummary>("/api/profile/learning-summary"),
  share: (courseId: string) => apiJson<{ id: string; token: string; url: string }>("/api/course-shares", json({ courseId })),
  shares: (courseId: string) => apiJson<Array<{ id: string; courseId: string; createdAt: string }>>(`/api/course-shares?courseId=${encodeURIComponent(courseId)}`),
  revokeShare: (id: string) => apiJson<{ ok: true }>(`/api/course-shares/${id}`, { method: "DELETE" }),
  cloneShare: (token: string) => apiJson<LearningCourseDetail>(`/api/course-shares/${token}/clone`, json({})),
  publish: (courseId: string, description: string) => apiJson<PublicCoursePreview>(`/api/learning-courses/${courseId}/publications`, json({ description, rightsDeclared: true })),
  market: () => apiJson<PublicCoursePreview[]>("/api/course-market", {}, false),
  clonePublication: (id: string) => apiJson<LearningCourseDetail>(`/api/course-publications/${id}/clone`, json({})),
  report: (body: CreateCourseReportRequest) => apiJson<{ id: string; status: string }>("/api/course-reports", json(body)),
  publicShare: (token: string) => apiJson<PublicCoursePreview>(`/api/public/course-shares/${token}`, {}, false),
};
