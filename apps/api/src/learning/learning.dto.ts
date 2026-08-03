import type {
  CourseReportCategory,
  CreateCourseReportRequest,
  CreateCourseShareRequest,
  CreateReviewSchedulesRequest,
  LearningAttemptRequest,
  LearningCourseInput,
  LearningExamKind,
  LearningScope,
  LearningSessionMode,
  LearningSkill,
  LearningSpellingOptions,
  LearningSpellingTranslationAssessmentRequest,
  ModerateCoursePublicationRequest,
  PublishLearningCourseRequest,
  RenameLearningCourseRequest,
  StartLearningSessionRequest,
  VocabularyUnitInput,
} from "@nalanda/types";

// Nest receives plain JSON objects, while LearningService performs the runtime
// validation. These DTO classes keep controller metadata and the shared Web/API
// camelCase contract tied to one source without duplicating validation rules.
export class LearningCourseDto implements LearningCourseInput {
  id!: string;
  title!: string;
  category!: "english_vocabulary";
  hasUnits!: boolean;
  locale!: "en-US";
  units!: VocabularyUnitInput[];
}

export class RenameLearningCourseDto implements RenameLearningCourseRequest {
  title!: string;
}

export class StartLearningSessionDto implements StartLearningSessionRequest {
  unitId!: string;
  mode!: LearningSessionMode;
  skills?: LearningSkill[];
  scope?: LearningScope;
  scheduleId?: string;
  spellingOptions?: LearningSpellingOptions;
  examPassPercent?: number;
  examKind?: LearningExamKind;
  wordIds?: string[];
}

export class LearningAttemptDto implements LearningAttemptRequest {
  attemptId!: string;
  expectedRevision!: number;
  wordId!: string;
  skill!: LearningSkill;
  answer!: LearningAttemptRequest["answer"];
}

export class LearningSpellingTranslationAssessmentDto
implements LearningSpellingTranslationAssessmentRequest {
  attemptId!: string;
  expectedRevision!: number;
  wordId!: string;
  answer!: string;
}

export class CreateReviewSchedulesDto implements CreateReviewSchedulesRequest {
  sourceSessionId!: string;
  offsets!: Array<3 | 7 | 15 | 30>;
}

export class CreateCourseShareDto implements CreateCourseShareRequest {
  courseId!: string;
}

export class PublishLearningCourseDto implements PublishLearningCourseRequest {
  description!: string;
  rightsDeclared!: boolean;
}

export class CreateCourseReportDto implements CreateCourseReportRequest {
  publicationId?: string;
  shareId?: string;
  category!: CourseReportCategory;
  details!: string;
}

export class ModerateCoursePublicationDto implements ModerateCoursePublicationRequest {
  action!: "hide" | "restore" | "withdraw";
  reason!: string;
}
