"""Private Materials AI contracts.

This module intentionally contains no public upload endpoint. NestJS performs
authentication and ownership checks, then sends a short-lived private Storage
URL to these internal-only contracts.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class QuestionCounts(StrictModel):
    singleChoice: int = Field(ge=0, le=100)
    multipleChoice: int = Field(ge=0, le=100)
    trueFalse: int = Field(ge=0, le=100)
    fillBlank: int = Field(ge=0, le=100)
    shortAnswer: int = Field(ge=0, le=100)
    essay: int = Field(ge=0, le=100)

    def total(self) -> int:
        return sum(self.model_dump().values())


class ExamSettings(StrictModel):
    language: Literal["auto", "en", "zh"]
    difficulty: Literal["introductory", "intermediate", "advanced", "mixed"]
    durationMinutes: int = Field(ge=15, le=240)
    totalMarks: int = Field(ge=20, le=200)
    questionCounts: QuestionCounts
    answerDetail: Literal["concise", "detailed"]
    focus: str = Field(max_length=200)

    @model_validator(mode="after")
    def question_total(self):
        if not 5 <= self.questionCounts.total() <= 100:
            raise ValueError("total questions must be between 5 and 100")
        if self.totalMarks < self.questionCounts.total():
            raise ValueError("total marks must be at least the number of questions")
        return self


class MaterialSource(StrictModel):
    id: str
    name: str = Field(min_length=1, max_length=300)
    type: str
    sizeBytes: int = Field(gt=0, le=25 * 1024 * 1024)
    signedUrl: HttpUrl


class ParseCacheInput(StrictModel):
    sourceSha256: str
    parserVersion: str
    auditVersion: str
    visionModel: str
    document: dict[str, Any]


class ProcessExamRequest(StrictModel):
    jobId: str
    leaseToken: str
    userId: str
    material: MaterialSource
    settings: ExamSettings
    cache: ParseCacheInput | None = None
    callbackUrl: HttpUrl
    callbackToken: str = Field(min_length=16, max_length=500)


class DocumentBlock(StrictModel):
    id: str
    order: float
    kind: Literal["heading", "paragraph", "table", "formula", "chart", "image", "metadata"]
    text: str
    page: int | None = None
    slide: int | None = None
    label: str
    source: Literal["parser", "vision"] = "parser"


class VisualRegion(StrictModel):
    id: str
    order: float
    page: int | None = None
    slide: int | None = None
    label: str
    reason: str
    localPath: str


class ParseDiagnostic(StrictModel):
    rangeId: str
    severity: Literal["info", "warning", "failure"]
    code: str
    message: str


class DocumentIR(StrictModel):
    version: Literal["document-ir.v1"] = "document-ir.v1"
    title: str
    sourceType: str
    pageCount: int = Field(ge=0, le=250)
    slideCount: int = Field(ge=0, le=250)
    blocks: list[DocumentBlock]
    diagnostics: list[ParseDiagnostic]


class AuditRange(StrictModel):
    rangeId: str
    reason: str


class AuditResult(StrictModel):
    classification: Literal["safe", "malicious", "uncertain", "benign_educational"]
    rationale: str
    failedRanges: list[AuditRange]
    injectionLocations: list[str]


class VisualExtractBlock(StrictModel):
    kind: Literal["heading", "paragraph", "table", "formula", "chart", "image", "metadata"]
    text: str
    label: str


class VisualExtractResult(StrictModel):
    readingOrder: list[VisualExtractBlock]
    unreadableAreas: list[str]
    suspectedEmbeddedInstructions: list[str]


QuestionType = Literal["single_choice", "multiple_choice", "true_false", "fill_blank", "short_answer", "essay"]


class SourceRef(StrictModel):
    blockId: str
    page: int | None = None
    slide: int | None = None
    label: str


class GeneratedQuestion(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    type: QuestionType
    prompt: str = Field(min_length=1, max_length=10_000)
    marks: int = Field(ge=1, le=100)
    options: list[str] = Field(max_length=12)
    correctOptionIndexes: list[int] = Field(max_length=12)
    acceptedAnswers: list[str] = Field(max_length=30)
    modelAnswer: str = Field(max_length=20_000)
    explanation: str = Field(max_length=20_000)
    rubric: list[str] = Field(max_length=30)
    sourceRefs: list[SourceRef] = Field(min_length=1, max_length=20)


class GeneratedSection(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    instructions: str = Field(max_length=2_000)
    questions: list[GeneratedQuestion] = Field(min_length=1)


class GeneratedExam(StrictModel):
    schemaVersion: Literal["generated-exam.v1"] = "generated-exam.v1"
    title: str = Field(min_length=1, max_length=160)
    language: Literal["en", "zh"]
    difficulty: Literal["introductory", "intermediate", "advanced", "mixed"]
    durationMinutes: int = Field(ge=15, le=240)
    totalMarks: int = Field(ge=20, le=200)
    instructions: list[str] = Field(max_length=20)
    sections: list[GeneratedSection] = Field(min_length=1, max_length=20)


class ReviewResult(StrictModel):
    valid: bool
    issues: list[str] = Field(max_length=30)


class UsageEvent(StrictModel):
    purpose: Literal[
        "parse_audit",
        "visual_recovery",
        "safety_audit",
        "exam_generation",
        "exam_repair",
        "exam_review",
        "exam_grading",
    ]
    model: str
    requestId: str | None = None
    promptTokens: int | None = Field(default=None, ge=0)
    completionTokens: int | None = Field(default=None, ge=0)
    totalTokens: int | None = Field(default=None, ge=0)
    costMicroUsd: int | None = Field(default=None, ge=0)
    durationMs: int = Field(ge=0)
    zdrEnforced: bool = True
    status: Literal["succeeded", "failed"]
    errorCode: str | None = None


class SubjectiveQuestion(StrictModel):
    id: str
    prompt: str
    marks: int = Field(ge=1, le=100)
    modelAnswer: str
    rubric: list[str]
    learnerAnswer: Any = None


class GradeExamRequest(StrictModel):
    attemptId: str
    questions: list[SubjectiveQuestion] = Field(min_length=1, max_length=100)
    language: Literal["en", "zh"]


class GradedAnswer(StrictModel):
    questionId: str
    awardedMarks: float = Field(ge=0)
    correct: bool | None = None
    feedback: str = Field(max_length=1000)


class GradingResult(StrictModel):
    results: list[GradedAnswer]
