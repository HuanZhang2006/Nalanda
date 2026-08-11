class PipelineError(Exception):
    """Safe, stable failure returned to NestJS without source content."""

    def __init__(self, code: str, message: str, status_code: int = 422, usage_events=None):
        super().__init__(message)
        self.code = code
        self.safe_message = message
        self.status_code = status_code
        self.usage_events = usage_events or []
