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

// ── Materials AI / generated exams v1 ─────────────────────────────────────

export type AiPlanCode = "free";
export type AiQuotaKind = "generation" | "grading";
export type AiPipeline = "document_ir_v1" | "luna_native_file_v1";
export type AiGenerationStatus =
  | "queued"
  | "processing"
  | "deleting"
  | "succeeded"
  | "failed"
  | "cancelled";
export type AiGenerationStage =
  | "queued"
  | "validating"
  | "preparingSource"
  | "extracting"
  | "auditing"
  | "visualRecovery"
  | "generating"
  | "organizing"
  | "answering"
  | "reviewing"
  | "saving"
  | "cleaning"
  | "succeeded"
  | "failed"
  | "cancelled";
export type GeneratedExamQuestionType =
  | "single_choice"
  | "multiple_choice"
  | "true_false"
  | "fill_blank"
  | "short_answer"
  | "essay";

export interface AiExamQuestionCounts {
  singleChoice: number;
  multipleChoice: number;
  trueFalse: number;
  fillBlank: number;
  shortAnswer: number;
  essay: number;
}

export interface AiExamGenerationSettings {
  language: "auto" | "en" | "zh";
  difficulty: "introductory" | "intermediate" | "advanced" | "mixed";
  durationMinutes: number;
  totalMarks: number;
  questionCounts: AiExamQuestionCounts;
  answerDetail: "concise" | "detailed";
  focus: string;
}

export interface CreateAiExamJobRequest {
  idempotencyKey: string;
  kind: "exam";
  pipeline: AiPipeline;
  consentVersion: number;
  settings: AiExamGenerationSettings;
}

export interface AiKnowledgeGraphGenerationSettings {
  language: "auto" | "en" | "zh";
  detail: "comprehensive";
  focus: string;
}

export interface CreateAiKnowledgeGraphJobRequest {
  idempotencyKey: string;
  kind: "knowledge_graph";
  pipeline: AiPipeline;
  consentVersion: number;
  settings: AiKnowledgeGraphGenerationSettings;
}

export type CreateAiMaterialJobRequest = CreateAiExamJobRequest | CreateAiKnowledgeGraphJobRequest;

export interface AiQuotaBucket {
  limit: number;
  consumed: number;
  reserved: number;
  remaining: number;
}

export interface AiQuotaSummary {
  plan: AiPlanCode;
  localDate: string;
  timezone: string;
  resetsAt: string;
  generation: AiQuotaBucket;
  grading: AiQuotaBucket;
}

export interface AiGenerationJob {
  id: string;
  materialId: string | null;
  materialName: string;
  courseId: string | null;
  kind: "exam" | "knowledge_graph" | "knowledge_question";
  pipeline: AiPipeline;
  model: string;
  status: AiGenerationStatus;
  stage: AiGenerationStage;
  progress: number;
  queuePosition: number | null;
  settings: AiExamGenerationSettings | AiKnowledgeGraphGenerationSettings | Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  noteId: string | null;
  retryable: boolean;
  resumeUntil: string | null;
  checkpointStage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AiPipelineCapability {
  pipeline: AiPipeline;
  available: boolean;
  default: boolean;
  model: string;
  provider: string;
  reasonCode: string | null;
}

export interface AiMaterialCapabilities {
  materialId: string;
  capabilities: AiPipelineCapability[];
}

export interface AiJobDeleteResult {
  jobId: string;
  status: "deleted" | "cleaning";
  quotaConsumed: boolean;
}

export interface AiJobClearResult {
  requested: number;
  deleted: number;
  cleaning: number;
}

export interface KnowledgeGraphNodePosition {
  nodeId: string;
  x: number;
  y: number;
}

export interface KnowledgeGraphViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface KnowledgeGraphLayout {
  noteId: string;
  artifactVersion: string;
  revision: number;
  positions: KnowledgeGraphNodePosition[];
  viewport: KnowledgeGraphViewport;
  updatedAt: string | null;
}

export interface SaveKnowledgeGraphLayoutRequest {
  artifactVersion: string;
  expectedRevision: number;
  positions: KnowledgeGraphNodePosition[];
  viewport: KnowledgeGraphViewport;
}

export interface GeneratedKnowledgeSourceRef {
  blockId: string;
  page: number | null;
  slide: number | null;
  label: string;
  locatorKind?: "block" | "page" | "slide" | "section" | "image" | "record" | "unknown";
  locatorIndex?: number | null;
}

export type GeneratedKnowledgeNodeKind =
  | "concept"
  | "definition"
  | "process"
  | "formula"
  | "example"
  | "evidence"
  | "comparison"
  | "method"
  | "person"
  | "event"
  | "term";

export interface GeneratedKnowledgeNodeV1 {
  id: string;
  title: string;
  kind: GeneratedKnowledgeNodeKind;
  level: number;
  sourceOrder: number;
  summary: string;
  explanation: string;
  keyDetails: string[];
  examples: string[];
  formulas: string[];
  commonMisconceptions: string[];
  checkQuestions: string[];
  keywords: string[];
  sourceRefs: GeneratedKnowledgeSourceRef[];
}

export type GeneratedKnowledgeEdgeRelation =
  | "sequence"
  | "prerequisite"
  | "part_of"
  | "causes"
  | "supports"
  | "contrasts"
  | "applies_to"
  | "example_of"
  | "related";

export interface GeneratedKnowledgeEdgeV1 {
  id: string;
  from: string;
  to: string;
  relation: GeneratedKnowledgeEdgeRelation;
  label: string;
  explanation: string;
}

export interface GeneratedKnowledgeGraphV1 {
  schemaVersion: "generated-knowledge-graph.v1";
  sourceMode?: "document_ir" | "native_file";
  title: string;
  language: "en" | "zh";
  overview: string;
  learningObjectives: string[];
  nodes: GeneratedKnowledgeNodeV1[];
  edges: GeneratedKnowledgeEdgeV1[];
}

export interface GeneratedExamSourceRef {
  blockId: string;
  page: number | null;
  slide: number | null;
  label: string;
  locatorKind?: "block" | "page" | "slide" | "section" | "image" | "record" | "unknown";
  locatorIndex?: number | null;
}

export interface GeneratedExamQuestionV1 {
  id: string;
  type: GeneratedExamQuestionType;
  prompt: string;
  marks: number;
  options: string[];
  correctOptionIndexes: number[];
  acceptedAnswers: string[];
  modelAnswer: string;
  explanation: string;
  rubric: string[];
  sourceRefs: GeneratedExamSourceRef[];
}

export interface GeneratedExamSectionV1 {
  id: string;
  title: string;
  instructions: string;
  questions: GeneratedExamQuestionV1[];
}

export interface GeneratedExamV1 {
  schemaVersion: "generated-exam.v1";
  sourceMode?: "document_ir" | "native_file";
  title: string;
  language: "en" | "zh";
  difficulty: AiExamGenerationSettings["difficulty"];
  durationMinutes: number;
  totalMarks: number;
  instructions: string[];
  sections: GeneratedExamSectionV1[];
}

export interface GeneratedNoteSummary {
  id: string;
  courseId: string | null;
  courseName: string;
  courseCode: string | null;
  title: string;
  kind: "ai_exam" | "ai_knowledge_graph";
  pipeline: AiPipeline;
  model: string;
  materialName: string;
  sourceDeleted: boolean;
  questionCount: number;
  totalMarks: number;
  nodeCount: number;
  edgeCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface GeneratedExamNoteDetail extends GeneratedNoteSummary {
  kind: "ai_exam";
  exam: GeneratedExamV1;
}

export interface GeneratedKnowledgeNoteDetail extends GeneratedNoteSummary {
  kind: "ai_knowledge_graph";
  graph: GeneratedKnowledgeGraphV1;
}

export type GeneratedNoteDetail = GeneratedExamNoteDetail | GeneratedKnowledgeNoteDetail;

export interface CreateKnowledgeNodeQuestionRequest {
  idempotencyKey: string;
  question: string;
}

export interface KnowledgeNodeAnswerV1 {
  schemaVersion: "knowledge-node-answer.v1";
  answer: string;
  keyPoints: string[];
  sourceRefs: GeneratedKnowledgeSourceRef[];
  followUpQuestions: string[];
}

export interface KnowledgeNodeQuestion {
  id: string;
  noteId: string;
  nodeId: string;
  question: string;
  pipeline: AiPipeline;
  status: AiGenerationStatus;
  answer: KnowledgeNodeAnswerV1 | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  answeredAt: string | null;
}

export type ExamAttemptStatus =
  | "in_progress"
  | "submitted_ungraded"
  | "grading"
  | "completed";

export interface ExamAnswerInput {
  questionId: string;
  value: string | string[] | number | number[] | boolean | null;
}

export interface ExamAttemptAnswerResult {
  questionId: string;
  awardedMarks: number | null;
  correct: boolean | null;
  feedback: string | null;
}

export interface GeneratedExamAttempt {
  id: string;
  noteId: string;
  status: ExamAttemptStatus;
  revision: number;
  deadlineAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  objectiveScore: number;
  objectiveMarks: number;
  totalScore: number | null;
  totalMarks: number;
  answers: ExamAnswerInput[];
  results: ExamAttemptAnswerResult[];
  exam: Omit<GeneratedExamV1, "sections"> & {
    sections: Array<Omit<GeneratedExamSectionV1, "questions"> & {
      questions: Array<Omit<GeneratedExamQuestionV1,
        "correctOptionIndexes" | "acceptedAnswers" | "modelAnswer" | "explanation" | "rubric">>;
    }>;
  };
  serverNow: string;
}

export interface SaveExamAnswersRequest {
  operationId: string;
  expectedRevision: number;
  answers: ExamAnswerInput[];
}

export interface SubmitExamAttemptRequest {
  operationId: string;
  expectedRevision: number;
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
  retryAfterSeconds?: number;
}

// ── Points rewards and moderation ────────────────────────────────────────────

export type PointRewardSuppressedReason = "daily_cap" | "moderation" | null;

export interface PointRewardReceipt {
  awardedAmount: number;
  dailyUsed: number | null;
  dailyLimit: number | null;
  localDate: string | null;
  suppressedReason: PointRewardSuppressedReason;
}

export type PointAbuseSignalStatus = "pending" | "reviewing" | "dismissed" | "escalated";

export interface PointAbuseSignal {
  id: string;
  signalType: "owner_concentration" | "reciprocal_pair" | "interaction_cluster" | "new_account_burst";
  accountIds: string[];
  targetOwnerId: string | null;
  targetRootKey: string | null;
  windowStart: string;
  windowEnd: string;
  metrics: Record<string, unknown>;
  status: PointAbuseSignalStatus;
  reviewerUserId: string | null;
  reviewNote: string | null;
  caseReference: string | null;
  detectedAt: string;
  updatedAt: string;
  reviewedAt: string | null;
}

export interface ReviewPointAbuseSignalRequest {
  status: Exclude<PointAbuseSignalStatus, "pending">;
  reviewNote?: string | null;
  caseReference?: string | null;
}

export interface ModeratePointRewardsRequest {
  action: "suppress" | "restore";
  targetType: "post" | "post_root" | "business_key";
  targetKey: string;
  reason: string;
  caseReference?: string | null;
}

export interface PointModerationResult {
  id: number;
  action: "suppress" | "restore";
  targetType: "post_root" | "business_key";
  targetKey: string;
  affectedEventCount: number;
  affectedAmount: number;
}
