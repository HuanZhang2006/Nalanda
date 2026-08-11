import os
import time
from pathlib import Path

import pytest

from app import main
from app.errors import PipelineError
from app.schemas import ProcessExamRequest


def request() -> ProcessExamRequest:
    return ProcessExamRequest.model_validate(
        {
            "jobId": "job-1",
            "leaseToken": "lease-1",
            "userId": "user-1",
            "material": {
                "id": "material-1",
                "name": "study.pdf",
                "type": "pdf",
                "sizeBytes": 100,
                "signedUrl": "https://storage.example/private.pdf?token=secret",
            },
            "settings": {
                "language": "en",
                "difficulty": "mixed",
                "durationMinutes": 60,
                "totalMarks": 20,
                "questionCounts": {
                    "singleChoice": 5,
                    "multipleChoice": 0,
                    "trueFalse": 0,
                    "fillBlank": 0,
                    "shortAnswer": 0,
                    "essay": 0,
                },
                "answerDetail": "detailed",
                "focus": "",
            },
            "callbackUrl": "http://api:3000/api/internal/ai-jobs/job-1/progress",
            "callbackToken": "test-internal-token",
        }
    )


@pytest.mark.asyncio
async def test_job_directory_is_removed_after_a_pipeline_failure(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("AI_INTERNAL_TOKEN", "test-internal-token")
    monkeypatch.setattr(main, "TEMP_ROOT", tmp_path / "worker")
    monkeypatch.setattr(main, "MIN_FREE_BYTES", 0)

    async def fail(_request, workdir):
        (workdir / "intermediate.txt").write_text("private extracted text")
        raise PipelineError("AI_BAD_JSON", "Provider output was invalid")

    monkeypatch.setattr(main, "process_exam", fail)
    with pytest.raises(PipelineError):
        await main.material_exam(request(), "test-internal-token")
    assert list(main.TEMP_ROOT.iterdir()) == []


def test_production_readiness_rejects_the_fake_provider(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(main, "TEMP_ROOT", tmp_path / "worker")
    monkeypatch.setattr(main, "MIN_FREE_BYTES", 0)
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setenv("MATERIAL_AI_FAKE_PROVIDER", "true")
    monkeypatch.setenv("AI_INTERNAL_TOKEN", "test-internal-token")
    result = main.health()
    assert result["status"] == "error"
    assert result["deps"]["openrouter"] == "unavailable"


def test_startup_sweeper_removes_only_orphaned_job_directories(monkeypatch, tmp_path: Path):
    root = tmp_path / "worker"
    stale = root / "job-stale"
    recent = root / "job-recent"
    stale.mkdir(parents=True)
    recent.mkdir()
    (stale / "private.txt").write_text("temporary extracted content")
    os.utime(stale, (time.time() - 3700, time.time() - 3700))
    monkeypatch.setattr(main, "TEMP_ROOT", root)

    assert main._sweep_stale() == 1
    assert not stale.exists()
    assert recent.exists()
