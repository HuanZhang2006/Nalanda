"""Private Materials AI contracts.

This module intentionally contains no public upload endpoint. NestJS performs
authentication and ownership checks, then sends a short-lived private Storage
URL to these internal-only contracts.
"""

from __future__ import annotations

from typing import Any, Literal
from uuid import uuid4

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


class WorkerCallbacks(StrictModel):
    baseUrl: HttpUrl
    token: str = Field(min_length=16, max_length=500)
    leaseToken: str = Field(min_length=1, max_length=100)


class CancelMaterialJobRequest(StrictModel):
    leaseToken: str | None = Field(default=None, min_length=1, max_length=100)
    callbackBaseUrl: HttpUrl
    callbackToken: str = Field(min_length=16, max_length=500)


class KnowledgeGraphSettings(StrictModel):
    language: Literal["auto", "en", "zh"]
    detail: Literal["comprehensive"] = "comprehensive"
    focus: str = Field(max_length=200)


class ProcessMaterialJobRequest(StrictModel):
    jobId: str = Field(min_length=1, max_length=100)
    kind: Literal["exam", "knowledge_graph", "knowledge_question"]
    pipeline: Literal["document_ir_v1", "luna_native_file_v1"] = "document_ir_v1"
    userId: str = Field(min_length=1, max_length=100)
    material: MaterialSource | None = None
    settings: ExamSettings | KnowledgeGraphSettings | None = None
    cache: ParseCacheInput | None = None
    callbacks: WorkerCallbacks
    checkpoint: dict[str, Any] | None = None
    budgetMicroUsd: int = Field(gt=0)
    question: str | None = Field(default=None, max_length=2000)
    nodeId: str | None = Field(default=None, max_length=80)
    graph: dict[str, Any] | None = None
    document: dict[str, Any] | None = None

    @model_validator(mode="after")
    def kind_shape(self):
        if self.kind == "exam":
            if self.material is None or not isinstance(self.settings, ExamSettings):
                raise ValueError("exam requires material and exam settings")
        elif self.kind == "knowledge_graph":
            if self.material is None or not isinstance(self.settings, KnowledgeGraphSettings):
                raise ValueError("knowledge graph requires material and graph settings")
        elif not self.question or not self.nodeId or self.graph is None:
            raise ValueError("knowledge question requires question, node and graph")
        return self


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
    blockId: str = ""
    page: int | None = None
    slide: int | None = None
    label: str
    locatorKind: Literal["block", "page", "slide", "section", "image", "record", "unknown"] = "block"
    locatorIndex: int | None = None


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
    sourceMode: Literal["document_ir", "native_file"] = "document_ir"
    title: str = Field(min_length=1, max_length=160)
    language: Literal["en", "zh"]
    difficulty: Literal["introductory", "intermediate", "advanced", "mixed"]
    durationMinutes: int = Field(ge=15, le=240)
    totalMarks: int = Field(ge=20, le=200)
    instructions: list[str] = Field(max_length=20)
    sections: list[GeneratedSection] = Field(min_length=1, max_length=20)


KnowledgeNodeKind = Literal[
    "concept", "definition", "process", "formula", "example", "evidence",
    "comparison", "method", "person", "event", "term",
]
KnowledgeEdgeRelation = Literal[
    "sequence", "prerequisite", "part_of", "causes", "supports", "contrasts",
    "applies_to", "example_of", "related",
]


class GeneratedKnowledgeNode(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    kind: KnowledgeNodeKind
    level: int = Field(ge=0, le=12)
    sourceOrder: float = Field(ge=0)
    summary: str = Field(min_length=1, max_length=1000)
    explanation: str = Field(min_length=1, max_length=12000)
    keyDetails: list[str] = Field(max_length=30)
    examples: list[str] = Field(max_length=20)
    formulas: list[str] = Field(max_length=20)
    commonMisconceptions: list[str] = Field(max_length=20)
    checkQuestions: list[str] = Field(max_length=20)
    keywords: list[str] = Field(max_length=30)
    sourceRefs: list[SourceRef] = Field(min_length=1, max_length=20)


class GeneratedKnowledgeEdge(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    from_: str = Field(alias="from", min_length=1, max_length=80)
    to: str = Field(min_length=1, max_length=80)
    relation: KnowledgeEdgeRelation
    label: str = Field(max_length=200)
    explanation: str = Field(max_length=2000)


class GeneratedKnowledgeGraph(StrictModel):
    schemaVersion: Literal["generated-knowledge-graph.v1"] = "generated-knowledge-graph.v1"
    sourceMode: Literal["document_ir", "native_file"] = "document_ir"
    title: str = Field(min_length=1, max_length=160)
    language: Literal["en", "zh"]
    overview: str = Field(min_length=1, max_length=12000)
    learningObjectives: list[str] = Field(max_length=30)
    nodes: list[GeneratedKnowledgeNode] = Field(min_length=1, max_length=250)
    edges: list[GeneratedKnowledgeEdge] = Field(max_length=1000)


class KnowledgeNodeAnswer(StrictModel):
    schemaVersion: Literal["knowledge-node-answer.v1"] = "knowledge-node-answer.v1"
    answer: str = Field(min_length=1, max_length=12000)
    keyPoints: list[str] = Field(max_length=30)
    sourceRefs: list[SourceRef] = Field(min_length=1, max_length=20)
    followUpQuestions: list[str] = Field(max_length=10)


class ReviewResult(StrictModel):
    valid: bool
    issues: list[str] = Field(max_length=30)


class UsageEvent(StrictModel):
    eventId: str = Field(default_factory=lambda: str(uuid4()))
    purpose: Literal[
        "parse_audit",
        "visual_recovery",
        "safety_audit",
        "exam_generation",
        "exam_repair",
        "exam_review",
        "exam_grading",
        "knowledge_graph_generation",
        "knowledge_graph_review",
        "knowledge_graph_repair",
        "knowledge_node_question",
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
    upstreamProvider: str | None = None
    upstreamEndpoint: str | None = None


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
    pipeline: Literal["document_ir_v1", "luna_native_file_v1"] = "document_ir_v1"
    callbacks: WorkerCallbacks | None = None
    budgetMicroUsd: int | None = Field(default=None, gt=0)
    checkpoint: dict[str, Any] | None = None

    @model_validator(mode="after")
    def async_job_requires_budget(self):
        if self.callbacks is not None and self.budgetMicroUsd is None:
            raise ValueError("asynchronous grading requires an accounting budget")
        return self


class GradedAnswer(StrictModel):
    questionId: str
    awardedMarks: float = Field(ge=0)
    correct: bool | None = None
    feedback: str = Field(max_length=1000)


class GradingResult(StrictModel):
    results: list[GradedAnswer]


class GradingWorkerResult(StrictModel):
    subjectiveScore: float = Field(ge=0)
    results: list[GradedAnswer]
