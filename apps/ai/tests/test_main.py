import asyncio
import os
import time
from pathlib import Path

import pytest

from app import main
from app.errors import PipelineError
from app.schemas import (
    CancelMaterialJobRequest,
    GradeExamRequest,
    ProcessExamRequest,
    ProcessMaterialJobRequest,
    UsageEvent,
)


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
    monkeypatch.setattr(main, "RESUME_TTL_SECONDS", 3600)

    assert main._sweep_stale() == 1
    assert not stale.exists()
    assert recent.exists()


def test_sweeper_honors_the_configured_five_minute_resume_ttl(monkeypatch, tmp_path: Path):
    root = tmp_path / "worker"
    stale = root / "job-short-ttl"
    stale.mkdir(parents=True)
    (stale / "resume-checkpoint.json").write_text("{}")
    os.utime(stale, (time.time() - 310, time.time() - 310))
    monkeypatch.setattr(main, "TEMP_ROOT", root)
    monkeypatch.setattr(main, "RESUME_TTL_SECONDS", 300)

    assert main._sweep_stale() == 1
    assert not stale.exists()


def test_sweeper_never_removes_an_active_long_running_job(monkeypatch, tmp_path: Path):
    root = tmp_path / "worker"
    job_id = "22222222-2222-4222-8222-222222222222"
    active = root / f"job-{job_id}"
    active.mkdir(parents=True)
    os.utime(active, (time.time() - 7200, time.time() - 7200))
    monkeypatch.setattr(main, "TEMP_ROOT", root)
    monkeypatch.setattr(main, "RESUME_TTL_SECONDS", 3600)
    main.active_jobs[(job_id, "11111111-1111-4111-8111-111111111111")] = None

    try:
        assert main._sweep_stale() == 0
        assert active.exists()
    finally:
        main.active_jobs.clear()


def durable_request(lease: str = "11111111-1111-4111-8111-111111111111") -> ProcessMaterialJobRequest:
    return ProcessMaterialJobRequest.model_validate(
        {
            "jobId": "22222222-2222-4222-8222-222222222222",
            "kind": "exam",
            "userId": "33333333-3333-4333-8333-333333333333",
            "material": {
                "id": "44444444-4444-4444-8444-444444444444",
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
            "callbacks": {
                "baseUrl": "http://api:3000/api/internal/ai-jobs/22222222-2222-4222-8222-222222222222",
                "token": "test-internal-token",
                "leaseToken": lease,
            },
            "budgetMicroUsd": 500000,
        }
    )


def cancel_request(lease: str | None = "11111111-1111-4111-8111-111111111111") -> CancelMaterialJobRequest:
    return CancelMaterialJobRequest.model_validate({
        "leaseToken": lease,
        "callbackBaseUrl": "http://api:3000/api/internal/ai-jobs/22222222-2222-4222-8222-222222222222",
        "callbackToken": "test-internal-token",
    })


@pytest.mark.asyncio
async def test_durable_endpoint_returns_acceptance_before_running_the_pipeline(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("AI_INTERNAL_TOKEN", "test-internal-token")
    monkeypatch.setattr(main, "TEMP_ROOT", tmp_path / "worker")
    monkeypatch.setattr(main, "MIN_FREE_BYTES", 0)
    main.active_jobs.clear()
    main.cancelled_jobs.clear()

    async def blocked(_request):
        await asyncio.Event().wait()

    monkeypatch.setattr(main, "_run_material_job", blocked)

    response = await main.material_job(durable_request(), "test-internal-token")

    assert response == {"accepted": True, "replayed": False}
    key = (
        "22222222-2222-4222-8222-222222222222",
        "11111111-1111-4111-8111-111111111111",
    )
    assert key in main.active_jobs
    assert not main.active_jobs[key].done()
    main.active_jobs[key].cancel()
    await asyncio.gather(main.active_jobs[key], return_exceptions=True)
    main.active_jobs.clear()


@pytest.mark.asyncio
async def test_a_new_lease_is_not_deduplicated_behind_a_stale_worker(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("AI_INTERNAL_TOKEN", "test-internal-token")
    monkeypatch.setattr(main, "TEMP_ROOT", tmp_path / "worker")
    monkeypatch.setattr(main, "MIN_FREE_BYTES", 0)
    main.active_jobs.clear()

    async def blocked(_request):
        await asyncio.Event().wait()

    monkeypatch.setattr(main, "_run_material_job", blocked)
    old = durable_request()
    old_key = (old.jobId, old.callbacks.leaseToken)
    main.active_jobs[old_key] = asyncio.create_task(blocked(old))
    new = durable_request("55555555-5555-4555-8555-555555555555")

    response = await main.material_job(new, "test-internal-token")

    assert response == {"accepted": True, "replayed": False}
    assert len(main.active_jobs) == 2
    for task in main.active_jobs.values():
        task.cancel()
    await asyncio.gather(*main.active_jobs.values(), return_exceptions=True)
    main.active_jobs.clear()


@pytest.mark.asyncio
async def test_cancel_endpoint_interrupts_active_task_and_purges_private_workdir(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("AI_INTERNAL_TOKEN", "test-internal-token")
    monkeypatch.setattr(main, "TEMP_ROOT", tmp_path / "worker")
    monkeypatch.setattr(main, "MIN_FREE_BYTES", 0)
    main.active_jobs.clear()
    main.cancelled_jobs.clear()
    request_value = durable_request()
    workdir = main._workdir(request_value.jobId)
    workdir.mkdir(parents=True)
    (workdir / "private-source.pdf").write_bytes(b"private")
    process_cancelled = []

    async def blocked():
        await asyncio.Event().wait()

    def cancel_processes(path):
        process_cancelled.append(path)

    key = (request_value.jobId, request_value.callbacks.leaseToken)
    task = asyncio.create_task(blocked())
    main.active_jobs[key] = task
    monkeypatch.setattr(main, "cancel_workdir_processes", cancel_processes)

    response = await main.cancel_material_job(
        request_value.jobId,
        cancel_request(request_value.callbacks.leaseToken),
        "test-internal-token",
    )

    assert response == {"accepted": True, "purged": True}
    assert task.cancelled()
    assert not workdir.exists()
    assert process_cancelled == [workdir]
    assert request_value.jobId in main.cancelled_jobs
    main.active_jobs.clear()
    main.cancelled_jobs.clear()


@pytest.mark.asyncio
async def test_cancel_flushes_spooled_provider_cost_before_purging(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("AI_INTERNAL_TOKEN", "test-internal-token")
    monkeypatch.setattr(main, "TEMP_ROOT", tmp_path / "worker")
    main.active_jobs.clear()
    main.cancelled_jobs.clear()
    request_value = durable_request()
    workdir = main._workdir(request_value.jobId)
    workdir.mkdir(parents=True)
    event = UsageEvent(
        purpose="exam_generation",
        model="openai/gpt-5.6-luna",
        requestId="provider-request-before-cancel",
        promptTokens=10,
        completionTokens=20,
        totalTokens=30,
        costMicroUsd=42,
        durationMs=100,
        zdrEnforced=True,
        status="succeeded",
        upstreamProvider="OpenAI",
    )
    (workdir / f"usage-{event.eventId}.json").write_text(event.model_dump_json())
    callbacks: list[dict] = []

    class FakeResponse:
        is_success = True

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def post(self, _url, **kwargs):
            callbacks.append(kwargs["json"])
            return FakeResponse()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeClient)
    response = await main.cancel_material_job(
        request_value.jobId,
        cancel_request(request_value.callbacks.leaseToken),
        "test-internal-token",
    )

    assert response == {"accepted": True, "purged": True}
    assert callbacks == [{
        "leaseToken": request_value.callbacks.leaseToken,
        "event": event.model_dump(),
    }]
    assert not workdir.exists()
    main.cancelled_jobs.clear()


@pytest.mark.asyncio
async def test_cancel_keeps_usage_spool_when_api_cannot_ack_cost(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("AI_INTERNAL_TOKEN", "test-internal-token")
    monkeypatch.setattr(main, "TEMP_ROOT", tmp_path / "worker")
    main.cancelled_jobs.clear()
    request_value = durable_request()
    workdir = main._workdir(request_value.jobId)
    workdir.mkdir(parents=True)
    event = UsageEvent(
        purpose="exam_generation", model="openai/gpt-5.6-luna",
        costMicroUsd=42, durationMs=100, zdrEnforced=True, status="succeeded",
        upstreamProvider="OpenAI",
    )
    (workdir / f"usage-{event.eventId}.json").write_text(event.model_dump_json())

    class OfflineClient:
        def __init__(self, **_kwargs):
            pass

        async def __aenter__(self):
            raise main.httpx.ConnectError("offline")

        async def __aexit__(self, *_args):
            return None

    monkeypatch.setattr(main.httpx, "AsyncClient", OfflineClient)
    response = await main.cancel_material_job(
        request_value.jobId,
        cancel_request(request_value.callbacks.leaseToken),
        "test-internal-token",
    )

    assert response == {"accepted": True, "purged": False}
    assert workdir.exists()
    assert list(workdir.glob("usage-*.json"))
    main.cancelled_jobs.clear()


def grading_request(lease: str = "11111111-1111-4111-8111-111111111111") -> GradeExamRequest:
    return GradeExamRequest.model_validate(
        {
            "attemptId": "22222222-2222-4222-8222-222222222222",
            "questions": [
                {
                    "id": "q1",
                    "prompt": "Explain the source concept.",
                    "marks": 10,
                    "modelAnswer": "A supported answer.",
                    "rubric": ["Uses the source concept"],
                    "learnerAnswer": "My answer",
                }
            ],
            "language": "en",
            "callbacks": {
                "baseUrl": "http://api:3000/api/internal/exam-attempts/22222222-2222-4222-8222-222222222222",
                "token": "test-internal-token",
                "leaseToken": lease,
            },
            "budgetMicroUsd": 50000,
        }
    )


@pytest.mark.asyncio
async def test_grading_endpoint_returns_acceptance_before_provider_work(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("AI_INTERNAL_TOKEN", "test-internal-token")
    monkeypatch.setattr(main, "TEMP_ROOT", tmp_path / "worker")
    monkeypatch.setattr(main, "MIN_FREE_BYTES", 0)
    main.active_jobs.clear()
    main.cancelled_jobs.clear()

    async def blocked(_request):
        await asyncio.Event().wait()

    monkeypatch.setattr(main, "_run_exam_grading", blocked)

    response = await main.exam_grading_job(grading_request(), "test-internal-token")

    assert response == {"accepted": True, "replayed": False}
    key = (
        "22222222-2222-4222-8222-222222222222",
        "11111111-1111-4111-8111-111111111111",
    )
    assert key in main.active_jobs
    main.active_jobs[key].cancel()
    await asyncio.gather(main.active_jobs[key], return_exceptions=True)
    main.active_jobs.clear()


@pytest.mark.asyncio
async def test_callback_outage_keeps_incremental_usage_spool_for_replay(monkeypatch, tmp_path: Path):
    monkeypatch.setenv("AI_INTERNAL_TOKEN", "test-internal-token")
    monkeypatch.setenv("MATERIAL_AI_FAKE_PROVIDER", "true")
    monkeypatch.setattr(main, "TEMP_ROOT", tmp_path / "worker")
    monkeypatch.setattr(main, "MIN_FREE_BYTES", 0)
    request_value = grading_request()

    async def callback_outage(*_args, **_kwargs):
        raise PipelineError("AI_CALLBACK_UNAVAILABLE", "API unavailable", 503)

    monkeypatch.setattr(main, "_post_callback", callback_outage)
    await main._run_exam_grading(request_value)

    workdir = main._workdir(request_value.attemptId)
    assert workdir.exists()
    assert list(workdir.glob("usage-*.json"))
    assert (workdir / "grading-result.json").exists()


@pytest.mark.asyncio
async def test_grading_shutdown_preserves_usage_and_validated_result_for_replay(
    monkeypatch, tmp_path: Path
):
    monkeypatch.setattr(main, "TEMP_ROOT", tmp_path / "worker")
    monkeypatch.setattr(main, "MIN_FREE_BYTES", 0)
    request_value = grading_request()
    workdir = main._workdir(request_value.attemptId)
    provider_returned = asyncio.Event()

    async def interrupted_grading(_request, usage_sink=None):
        await usage_sink(UsageEvent(
            purpose="exam_grading",
            model="deepseek/deepseek-v4-flash-0731",
            requestId="provider-before-shutdown",
            promptTokens=5,
            completionTokens=5,
            totalTokens=10,
            costMicroUsd=4,
            durationMs=10,
            zdrEnforced=True,
            status="succeeded",
        ))
        provider_returned.set()
        await asyncio.Event().wait()

    async def callback_outage(*_args, **_kwargs):
        raise PipelineError("AI_CALLBACK_UNAVAILABLE", "API unavailable", 503)

    monkeypatch.setattr(main, "grade_exam", interrupted_grading)
    monkeypatch.setattr(main, "_post_callback", callback_outage)
    task = asyncio.create_task(main._run_exam_grading(request_value))
    await provider_returned.wait()
    task.cancel()
    await asyncio.gather(task, return_exceptions=True)

    assert workdir.exists()
    assert list(workdir.glob("usage-*.json"))


@pytest.mark.asyncio
async def test_usage_spool_write_is_atomic_and_corruption_is_never_discarded(
    monkeypatch, tmp_path: Path
):
    monkeypatch.setattr(main, "TEMP_ROOT", tmp_path / "worker")
    request_value = durable_request()
    workdir = main._workdir(request_value.jobId)
    workdir.mkdir(parents=True)
    broken = workdir / "usage-11111111-1111-4111-8111-111111111111.json"
    broken.write_text("{truncated", encoding="utf-8")

    with pytest.raises(PipelineError, match="Provider accounting") as failure:
        await main._flush_usage(request_value, workdir)

    assert failure.value.code == "AI_USAGE_SPOOL_CORRUPT"
    assert broken.exists()


@pytest.mark.asyncio
async def test_grading_resumes_from_database_checkpoint_after_local_directory_loss(
    monkeypatch, tmp_path: Path
):
    monkeypatch.setattr(main, "TEMP_ROOT", tmp_path / "worker")
    monkeypatch.setattr(main, "MIN_FREE_BYTES", 0)
    result = {
        "subjectiveScore": 10,
        "results": [{
            "questionId": "q1", "awardedMarks": 10,
            "correct": True, "feedback": "Supported",
        }],
    }
    request_value = grading_request().model_copy(update={"checkpoint": {"result": result}})
    callbacks: list[tuple[str, dict]] = []

    async def should_not_grade(*_args, **_kwargs):
        raise AssertionError("a durable grading result must not call the provider again")

    async def callback_ok(_request, suffix, payload, **_kwargs):
        callbacks.append((suffix, payload))

    monkeypatch.setattr(main, "grade_exam", should_not_grade)
    monkeypatch.setattr(main, "_post_callback", callback_ok)

    await main._run_exam_grading(request_value)

    assert [suffix for suffix, _payload in callbacks] == ["checkpoint", "complete"]
    assert callbacks[-1][1]["result"] == result
    assert not main._workdir(request_value.attemptId).exists()


@pytest.mark.asyncio
async def test_material_callback_outage_resumes_from_local_artifact_without_repeating_provider(
    monkeypatch, tmp_path: Path
):
    monkeypatch.setenv("AI_INTERNAL_TOKEN", "test-internal-token")
    monkeypatch.setattr(main, "TEMP_ROOT", tmp_path / "worker")
    monkeypatch.setattr(main, "MIN_FREE_BYTES", 0)
    first = durable_request()
    provider_calls = 0

    async def callback_outage(*_args, **_kwargs):
        raise PipelineError("AI_CALLBACK_UNAVAILABLE", "API unavailable", 503)

    async def paid_pipeline(_request, _workdir, usage_sink=None, checkpoint_sink=None):
        nonlocal provider_calls
        provider_calls += 1
        await usage_sink(UsageEvent(
            purpose="exam_generation",
            model="deepseek/deepseek-v4-flash-0731",
            requestId="provider-request-1",
            promptTokens=10,
            completionTokens=10,
            totalTokens=20,
            costMicroUsd=9,
            durationMs=100,
            zdrEnforced=True,
            status="succeeded",
        ))
        await checkpoint_sink("artifact_ready", {
            "sourceSha256": "a" * 64,
            "artifactKind": "exam",
            "artifact": {"validated": True},
        })
        raise PipelineError("AI_CALLBACK_UNAVAILABLE", "checkpoint not acknowledged", 503)

    monkeypatch.setattr(main, "_post_callback", callback_outage)
    monkeypatch.setattr(main, "process_material_job", paid_pipeline)
    await main._run_material_job(first)

    workdir = main._workdir(first.jobId)
    local = main._read_local_checkpoint(workdir)
    assert local == {
        "checkpointStage": "artifact_ready",
        "sourceSha256": "a" * 64,
        "artifactKind": "exam",
        "artifact": {"validated": True},
    }
    assert list(workdir.glob("usage-*.json"))

    callbacks: list[str] = []

    async def callback_ok(_request, suffix, _payload, **_kwargs):
        callbacks.append(suffix)

    async def resumed_pipeline(request_value, _workdir, **_kwargs):
        assert request_value.checkpoint == local
        return {"kind": "exam", "usageEvents": []}

    monkeypatch.setattr(main, "_post_callback", callback_ok)
    monkeypatch.setattr(main, "process_material_job", resumed_pipeline)
    await main._run_material_job(
        durable_request("55555555-5555-4555-8555-555555555555")
    )

    assert provider_calls == 1
    assert callbacks == ["usage", "complete"]
    assert not workdir.exists()


@pytest.mark.asyncio
async def test_callback_outage_cannot_bypass_the_worker_cost_budget(
    monkeypatch, tmp_path: Path
):
    monkeypatch.setattr(main, "TEMP_ROOT", tmp_path / "worker")
    monkeypatch.setattr(main, "MIN_FREE_BYTES", 0)
    request_value = durable_request().model_copy(update={"budgetMicroUsd": 5})
    continued_after_budget = False

    async def callback_outage(*_args, **_kwargs):
        raise PipelineError("AI_CALLBACK_UNAVAILABLE", "API unavailable", 503)

    async def over_budget_pipeline(_request, _workdir, usage_sink=None, **_kwargs):
        nonlocal continued_after_budget
        await usage_sink(UsageEvent(
            purpose="exam_generation",
            model="deepseek/deepseek-v4-flash-0731",
            requestId="provider-request-over-budget",
            promptTokens=10,
            completionTokens=10,
            totalTokens=20,
            costMicroUsd=9,
            durationMs=100,
            zdrEnforced=True,
            status="succeeded",
        ))
        continued_after_budget = True
        return {"kind": "exam"}

    monkeypatch.setattr(main, "_post_callback", callback_outage)
    monkeypatch.setattr(main, "process_material_job", over_budget_pipeline)

    await main._run_material_job(request_value)

    assert not continued_after_budget
    workdir = main._workdir(request_value.jobId)
    assert workdir.exists()
    assert list(workdir.glob("usage-*.json"))


@pytest.mark.asyncio
async def test_material_wall_clock_timeout_is_retryable_after_persisting_the_latest_checkpoint(
    monkeypatch, tmp_path: Path
):
    monkeypatch.setattr(main, "TEMP_ROOT", tmp_path / "worker")
    monkeypatch.setattr(main, "MIN_FREE_BYTES", 0)
    monkeypatch.setattr(main, "JOB_TIMEOUT_SECONDS", 0.001)
    request_value = durable_request()
    callbacks: list[tuple[str, dict]] = []

    async def slow_pipeline(_request, workdir, checkpoint_sink=None, **_kwargs):
        payload = {"sourceSha256": "a" * 64, "document": {}}
        await checkpoint_sink("parsed", payload)
        await main._post_callback(_request, "checkpoint", {"stage": "parsed", "payload": payload})
        await main.asyncio.sleep(1)

    async def callback_ok(_request, suffix, payload, **_kwargs):
        callbacks.append((suffix, payload))

    monkeypatch.setattr(main, "process_material_job", slow_pipeline)
    monkeypatch.setattr(main, "_post_callback", callback_ok)

    await main._run_material_job(request_value)

    assert callbacks[0][0] == "checkpoint"
    assert callbacks[-1] == ("fail", {
        "code": "AI_WORKER_TIMEOUT",
        "message": "AI processing reached its bounded execution time; resume from the latest checkpoint",
        "retryable": True,
    })
    assert not main._workdir(request_value.jobId).exists()


@pytest.mark.asyncio
async def test_unexpected_grading_exception_is_persisted_instead_of_leaking_from_background_task(
    monkeypatch, tmp_path: Path
):
    monkeypatch.setattr(main, "TEMP_ROOT", tmp_path / "worker")
    monkeypatch.setattr(main, "MIN_FREE_BYTES", 0)
    request_value = grading_request()
    callbacks: list[tuple[str, dict]] = []

    async def broken_grading(*_args, **_kwargs):
        raise RuntimeError("private implementation detail")

    async def callback_ok(_request, suffix, payload, **_kwargs):
        callbacks.append((suffix, payload))

    monkeypatch.setattr(main, "grade_exam", broken_grading)
    monkeypatch.setattr(main, "_post_callback", callback_ok)

    await main._run_exam_grading(request_value)

    assert callbacks == [("fail", {
        "code": "AI_GRADING_FAILED", "message": "AI grading failed",
    })]
    assert not main._workdir(request_value.attemptId).exists()
