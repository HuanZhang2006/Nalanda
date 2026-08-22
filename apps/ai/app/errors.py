_DIAGNOSTIC_ENUMS: dict[str, set[str]] = {
    "stage": {"post_repair"},
    "initialGate": {"structural", "semantic"},
    "finalGate": {"structural", "semantic"},
}
_DIAGNOSTIC_LIST_ENUMS: dict[str, set[str]] = {
    "initialStructuralCodes": {
        "QUESTION_TYPE_COUNT",
        "TOTAL_MARKS",
        "EXAM_METADATA",
        "QUESTION_ID_UNIQUENESS",
        "SOURCE_REFERENCE",
        "CHOICE_SHAPE",
        "ANSWER_INDEX_RANGE",
        "SINGLE_CHOICE_CARDINALITY",
        "ACCEPTED_ANSWER",
        "RUBRIC",
        "OTHER_STRUCTURE",
    },
    "finalStructuralCodes": {
        "QUESTION_TYPE_COUNT",
        "TOTAL_MARKS",
        "EXAM_METADATA",
        "QUESTION_ID_UNIQUENESS",
        "SOURCE_REFERENCE",
        "CHOICE_SHAPE",
        "ANSWER_INDEX_RANGE",
        "SINGLE_CHOICE_CARDINALITY",
        "ACCEPTED_ANSWER",
        "RUBRIC",
        "OTHER_STRUCTURE",
    },
    "initialSemanticCategories": {
        "SOURCE_GROUNDING",
        "ANSWER_CORRECTNESS",
        "DISTRACTOR_QUALITY",
        "EXPLANATION_QUALITY",
        "ANSWERABILITY",
        "OTHER_SEMANTIC",
    },
    "finalSemanticCategories": {
        "SOURCE_GROUNDING",
        "ANSWER_CORRECTNESS",
        "DISTRACTOR_QUALITY",
        "EXPLANATION_QUALITY",
        "ANSWERABILITY",
        "OTHER_SEMANTIC",
    },
}
_DIAGNOSTIC_COUNTS = {
    "expectedQuestionCount",
    "actualQuestionCount",
    "expectedTotalMarks",
    "actualTotalMarks",
}


def safe_pipeline_diagnostics(value: dict[str, object] | None) -> dict[str, object]:
    """Keep only bounded, content-free fields safe for internal telemetry."""
    if not value:
        return {}
    result: dict[str, object] = {}
    for key, allowed in _DIAGNOSTIC_ENUMS.items():
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate in allowed:
            result[key] = candidate
    for key, allowed in _DIAGNOSTIC_LIST_ENUMS.items():
        candidate = value.get(key)
        if isinstance(candidate, list) and all(isinstance(item, str) and item in allowed for item in candidate):
            result[key] = sorted(set(candidate))
    for key in _DIAGNOSTIC_COUNTS:
        candidate = value.get(key)
        if isinstance(candidate, int) and not isinstance(candidate, bool) and 0 <= candidate <= 100_000:
            result[key] = candidate
    return result


class PipelineError(Exception):
    """Safe, stable failure returned to NestJS without source content."""

    def __init__(
        self,
        code: str,
        message: str,
        status_code: int = 422,
        usage_events=None,
        diagnostics: dict[str, object] | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.safe_message = message
        self.status_code = status_code
        self.usage_events = usage_events or []
        # Defense in depth: even an accidental future free-text field cannot
        # enter the internal response or protected-release logs.
        self.diagnostics = safe_pipeline_diagnostics(diagnostics)
