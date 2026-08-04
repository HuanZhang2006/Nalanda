// Nalanda 共享类型 —— 与原型 app/data.js 及 AI 微服务输出 schema 对齐

export type Language = "zh" | "en";
export type GenerationKind = "knowledge-list" | "quiz" | "graph" | "exam";
export type MaterialType = "pdf" | "ppt" | "doc" | "md" | "html" | "txt";

// ── AI 生成产物（= DB.knowledge / quiz / graph / exam）──
export interface KnowledgePoint {
  title: string;
  definition: string;
  tags: string[];
  order: number;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  type?: "single" | "multiple" | "cloze" | "short";
}

export interface GraphNode {
  id: string;
  label: string;
  level: number;
}
export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: [string, string][];
}

export interface ExamQuestion {
  prompt: string;
  marks: number;
}
export interface ExamSection {
  name: string;
  questions: ExamQuestion[];
}
export interface MockExam {
  title: string;
  meta: string;
  sections: ExamSection[];
}

// ── 生成请求 ──
export interface GenerateRequest {
  materialId: string;
  text?: string;
  lang: Language;
}

// ── Learning Courses v1 ────────────────────────────────────────────────────

export type LearningCourseCategory =
  | "english_vocabulary"
  | "knowledge_points"
  | "reading_comprehension"
  | "question_bank";
export type LearningSkill = "pronunciation" | "translation" | "spelling";
export type LearningSessionMode = "initial" | "review" | "exam";
export type LearningExamKind = "spelling" | "pronunciation";
export type LearningStage = "recognition" | LearningSkill | "completed";
export type LearningScope = "all" | "unlearned";

export interface LearningSpellingOptions {
  timeLimitEnabled: boolean;
  timeLimitSeconds: number;
  translationFirst: boolean;
}

export interface VocabularyWordInput {
  id: string;
  term: string;
  translations: string[];
  ipa?: string | null;
}

export interface VocabularyUnitInput {
  id: string;
  name: string;
  isSystem: boolean;
  words: VocabularyWordInput[];
}

export interface LearningCourseInput {
  id: string;
  title: string;
  category: "english_vocabulary";
  hasUnits: boolean;
  locale: "en-US";
  units: VocabularyUnitInput[];
}

export interface VocabularyWord extends VocabularyWordInput {
  normalizedTerm: string;
  position: number;
  progress: {
    recognitionSeen: boolean;
    initialPronunciationPassed: boolean;
    initialTranslationPassed: boolean;
    initialSpellingPassed: boolean;
    pronunciationReviewDates: string[];
    translationReviewDates: string[];
    spellingReviewDates: string[];
    wrongCount: number;
    reviewCount: number;
    /** Passed first-round threshold in a completed spelling exam containing this word. */
    spellingExamPassedAt: string | null;
    /** Passed first-round threshold in a completed pronunciation exam containing this word. */
    pronunciationExamPassedAt: string | null;
    /** Projected only when both exam pass timestamps are present. */
    learnedAt: string | null;
  };
}

export interface VocabularyUnit {
  id: string;
  name: string;
  position: number;
  isSystem: boolean;
  words: VocabularyWord[];
}

export interface LearningCourseSummary {
  id: string;
  title: string;
  category: "english_vocabulary";
  hasUnits: boolean;
  locale: "en-US";
  unitCount: number;
  wordCount: number;
  learnedCount: number;
  progressPercent: number;
  activeSessionId: string | null;
  canRepublish: boolean;
  originPublicationId: string | null;
  originShareId: string | null;
  originAuthorName: string | null;
  updatedAt: string;
}

export interface LearningCourseDetail extends LearningCourseSummary {
  units: VocabularyUnit[];
}

export interface LearningSessionItem {
  word: VocabularyWord;
  position: number;
  recognitionSeen: boolean;
  pronunciationPassed: boolean;
  translationPassed: boolean;
  spellingPassed: boolean;
  wrongCount: number;
}

export interface LearningSession {
  id: string;
  courseId: string;
  unitId: string | null;
  mode: LearningSessionMode;
  scope: LearningScope;
  selectedSkills: LearningSkill[];
  stage: LearningStage;
  active: boolean;
  revision: number;
  spellingOptions: LearningSpellingOptions;
  spellingTranslationAssessment: {
    attemptId: string;
    wordId: string;
    revision: number;
    correct: true;
  } | null;
  state: Record<string, unknown>;
  items: LearningSessionItem[];
}

export interface StartLearningSessionRequest {
  unitId: string;
  mode: LearningSessionMode;
  skills?: LearningSkill[];
  scope?: LearningScope;
  scheduleId?: string;
  spellingOptions?: LearningSpellingOptions;
  /** First-round accuracy required to record this exam requirement as passed. */
  examPassPercent?: number;
  /** Exam stage. Existing callers default to the translation-plus-spelling exam. */
  examKind?: LearningExamKind;
  /** Optional owner-scoped subset of words from unitId for review/exam sessions. */
  wordIds?: string[];
}

export type LearningExamHistoryStatus = "in_progress" | "completed" | "cancelled";

export interface LearningExamHistorySummary {
  id: string;
  courseId: string;
  courseTitle: string;
  unitId: string | null;
  unitName: string | null;
  examKind: LearningExamKind;
  requiredPercent: number;
  firstRoundAccuracyPercent: number;
  firstRoundCorrect: number;
  wordCount: number;
  passed: boolean | null;
  practiceCompleted: boolean;
  status: LearningExamHistoryStatus;
  attemptCount: number;
  wrongCount: number;
  startedAt: string;
  completedAt: string | null;
}

export interface LearningExamHistoryAttempt {
  id: string;
  wordId: string | null;
  term: string | null;
  skill: LearningSkill | "speech_assessment";
  correct: boolean | null;
  answer: string | null;
  pronunciationScore: number | null;
  accuracyScore: number | null;
  createdAt: string;
}

export interface LearningExamHistoryDetail extends LearningExamHistorySummary {
  words: Array<{
    wordId: string;
    term: string;
    ipa: string | null;
    translations: string[];
    wrongCount: number;
    passed: boolean;
  }>;
  attempts: LearningExamHistoryAttempt[];
}

export interface LearningAttemptRequest {
  attemptId: string;
  expectedRevision: number;
  wordId: string;
  skill: LearningSkill;
  answer: { wordId?: string; translations?: string[]; text?: string };
}

export interface LearningSessionChangedItem {
  wordId: string;
  recognitionSeen: boolean;
  pronunciationPassed: boolean;
  translationPassed: boolean;
  spellingPassed: boolean;
  wrongCount: number;
}

export interface LearningSessionPatch {
  stage: LearningStage;
  active: boolean;
  state: Record<string, unknown>;
  changedItem: LearningSessionChangedItem | null;
  nextWordId: string | null;
}

export interface LearningAttemptResult {
  attemptId: string;
  correct: boolean;
  expected: string | string[];
  revision: number;
  replayed: boolean;
  sessionPatch: LearningSessionPatch;
}

export interface LearningSpellingTranslationAssessmentRequest {
  attemptId: string;
  expectedRevision: number;
  wordId: string;
  answer: string;
}

export interface LearningSpellingTranslationAssessmentResult {
  attemptId: string;
  correct: boolean;
  expected: string[];
  feedback: string;
  revision: number;
  replayed: boolean;
  attemptResult: LearningAttemptResult | null;
}

export interface LearningTranslationTranscriptionRequest {
  expectedRevision: number;
  wordId: string;
}

export interface LearningTranslationTranscriptionResult {
  text: string;
  wordId: string;
  revision: number;
  language: string;
}

export interface LearningSessionMutationResult {
  revision: number;
  sessionPatch: LearningSessionPatch;
}

export interface LearningSessionCancelResult {
  sessionId: string;
  active: false;
  revision: number;
  cancelled: boolean;
}

export type LearningAudioAssetStatus = "missing" | "pending" | "processing" | "ready" | "failed";

export interface LearningAudioManifestAsset {
  wordId: string;
  cacheKey: string;
  status: LearningAudioAssetStatus;
  audioUrl: string;
  lastErrorCode: string | null;
}

export interface LearningAudioManifest {
  unitId: string;
  total: number;
  ready: number;
  pending: number;
  failed: number;
  synthesisVersion: string;
  assets: LearningAudioManifestAsset[];
}

export interface CreateReviewSchedulesRequest {
  sourceSessionId: string;
  offsets: Array<3 | 7 | 15 | 30>;
}

export interface ReviewSchedule {
  id: string;
  courseId: string;
  unitId: string;
  sourceSessionId: string;
  courseTitle?: string;
  unitName?: string;
  dueDate: string;
  skills: LearningSkill[];
  scope: LearningScope;
  status: "pending" | "completed" | "cancelled";
  completedSessionId: string | null;
  completedAt: string | null;
}

export interface CourseBadge {
  code: string;
  family: "vocab_words" | "vocab_courses" | "vocab_review_days";
  tier: 1 | 2 | 3;
  name: string;
  description: string;
  threshold: number;
  icon: string;
  awardedAt: string;
}

export interface LearningProfileSummary {
  courses: number;
  learnedWords: number;
  reviewDays: number;
  badges: CourseBadge[];
}

export interface CoursePublication {
  id: string;
  title: string;
  description: string;
  authorName: string;
  category: "english_vocabulary";
  hasUnits: boolean;
  locale: "en-US";
  version: number;
  unitCount: number;
  wordCount: number;
  cloneCount: number;
  createdAt: string;
}

export interface PublicCoursePreview extends CoursePublication {
  units: Array<{
    name: string;
    position: number;
    isSystem: boolean;
    words: Array<Pick<VocabularyWordInput, "term" | "translations" | "ipa">>;
  }>;
  shareId?: string;
  publicationId?: string;
}

export interface RenameLearningCourseRequest {
  title: string;
}

export interface CreateCourseShareRequest {
  courseId: string;
}

export interface PublishLearningCourseRequest {
  description: string;
  rightsDeclared: boolean;
}

export type CourseReportCategory =
  | "abuse"
  | "copyright"
  | "privacy"
  | "spam"
  | "academic_integrity"
  | "other";

export interface CreateCourseReportRequest {
  publicationId?: string;
  shareId?: string;
  category: CourseReportCategory;
  details: string;
}

export interface ModerateCoursePublicationRequest {
  action: "hide" | "restore" | "withdraw";
  reason: string;
}

export interface PronunciationPhoneme {
  phoneme: string;
  accuracyScore: number;
  needsPractice: boolean;
}

export interface PronunciationAssessment {
  accuracyScore: number;
  fluencyScore: number | null;
  completenessScore: number | null;
  pronunciationScore: number;
  passThreshold: number;
  passed: boolean;
  queuedForRetry: boolean;
  revision: number;
  sessionPatch: LearningSessionPatch;
  errorType: string | null;
  phonemes: PronunciationPhoneme[];
}

export interface ApiErrorBody {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
}
