"""Nalanda Materials AI worker. Internal-only; NestJS owns every public API."""

from __future__ import annotations

import asyncio
import hmac
import json
import os
import re
import shutil
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
from fastapi import FastAPI, Header, HTTPException, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .errors import PipelineError
from .openrouter import OpenRouterClient, fake_enabled
from .parsers import cancel_workdir_processes
from .pipeline import grade_exam, process_exam, process_material_job
from .schemas import (
    CancelMaterialJobRequest,
    GradeExamRequest,
    GradingWorkerResult,
    ProcessExamRequest,
    ProcessMaterialJobRequest,
    UsageEvent,
)

TEMP_ROOT = Path(os.getenv("MATERIAL_AI_TEMP_ROOT", "/tmp/nalanda-material-ai"))
JOB_TEMP_LIMIT = int(os.getenv("MATERIAL_AI_JOB_TEMP_LIMIT_BYTES", str(1024 * 1024 * 1024)))
MIN_FREE_BYTES = int(os.getenv("MATERIAL_AI_TEMP_MIN_FREE_BYTES", str(512 * 1024 * 1024)))
RESUME_TTL_SECONDS = int(os.getenv("MATERIAL_AI_RESUME_TTL_SECONDS", "86400"))
JOB_TIMEOUT_SECONDS = max(60, int(os.getenv("MATERIAL_AI_JOB_TIMEOUT_SECONDS", "1200")))
GRADING_TIMEOUT_SECONDS = max(30, int(os.getenv("MATERIAL_AI_GRADING_TIMEOUT_SECONDS", "240")))
worker_slot = asyncio.Semaphore(1)
active_jobs: dict[tuple[str, str], asyncio.Task[None]] = {}
cancelled_jobs: dict[str, float] = {}
JOB_ID = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-"
    r"[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$"
)
LOCAL_CHECKPOINT = "resume-checkpoint.json"
CHECKPOINT_RANK = {
    "parsed": 1,
    "audited": 2,
    "document_ready": 3,
    "artifact_ready": 4,
    "answer_ready": 4,
    "native_audited": 2,
    "native_artifact_ready": 4,
}


def _ensure_temp_root() -> None:
    TEMP_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(TEMP_ROOT, 0o700)


def _sweep_stale() -> int:
    _ensure_temp_root()
    # The database accepts a five-minute minimum resume TTL. Do not silently
    # keep private local checkpoints for an extra hour when an operator chooses
    # a shorter retention period.
    cutoff = time.time() - max(300, RESUME_TTL_SECONDS)
    active_names = {f"job-{job_id.lower()}" for job_id, _lease in tuple(active_jobs)}
    now = time.time()
    for job_id, expires_at in tuple(cancelled_jobs.items()):
        if expires_at <= now:
            cancelled_jobs.pop(job_id, None)
    removed = 0
    for child in TEMP_ROOT.iterdir():
        try:
            if child.name not in active_names and child.is_dir() and child.stat().st_mtime < cutoff:
                shutil.rmtree(child)
                removed += 1
        except OSError:
            continue
    return removed


async def _sweeper() -> None:
    while True:
        # Bound deletion lag while avoiding a hot filesystem scan for the
        # default one-day retention window.
        await asyncio.sleep(min(15 * 60, max(60, RESUME_TTL_SECONDS // 4)))
        await asyncio.to_thread(_sweep_stale)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _ensure_temp_root()
    await asyncio.to_thread(_sweep_stale)
    task = asyncio.create_task(_sweeper())
    try:
        yield
    finally:
        task.cancel()
        running = list(active_jobs.values())
        for running_task in running:
            running_task.cancel()
        if running:
            await asyncio.gather(*running, return_exceptions=True)
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Nalanda Materials AI",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None if os.getenv("NODE_ENV") == "production" else "/docs",
)


def _internal_token(value: str | None) -> None:
    expected = os.getenv("AI_INTERNAL_TOKEN", "")
    if not expected or not value or not hmac.compare_digest(expected.encode(), value.encode()):
        raise HTTPException(
            status_code=401, detail={"code": "INVALID_INTERNAL_TOKEN", "message": "Invalid AI worker token"}
        )


def _resource_gate() -> None:
    _ensure_temp_root()
    free = shutil.disk_usage(TEMP_ROOT).free
    if free < MIN_FREE_BYTES:
        raise PipelineError("AI_TEMP_DISK_PRESSURE", "AI processing is paused because temporary disk space is low", 503)


def _directory_size(path: Path) -> int:
    return sum(item.stat().st_size for item in path.rglob("*") if item.is_file())


@app.exception_handler(PipelineError)
async def pipeline_error(_request, error: PipelineError):
    return JSONResponse(
        status_code=error.status_code,
        content={
            "code": error.code,
            "message": error.safe_message,
            "usageEvents": error.usage_events,
            "diagnostics": error.diagnostics,
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_error(_request, _error: RequestValidationError):
    # FastAPI's default includes the rejected input. Internal requests contain a
    # signed Storage URL and callback token, so never echo validation payloads.
    return JSONResponse(
        status_code=422, content={"code": "INVALID_INTERNAL_REQUEST", "message": "Invalid AI worker request"}
    )


@app.get("/health")
def health():
    _ensure_temp_root()
    provider = OpenRouterClient()
    production_fake = os.getenv("NODE_ENV") == "production" and fake_enabled()
    libreoffice = shutil.which("libreoffice") or shutil.which("soffice")
    disk_ok = shutil.disk_usage(TEMP_ROOT).free >= MIN_FREE_BYTES
    ready = (
        provider.configured()
        and not production_fake
        and bool(libreoffice)
        and disk_ok
        and bool(os.getenv("AI_INTERNAL_TOKEN"))
    )
    return {
        "status": "ok" if ready else "error",
        "service": "nalanda-ai",
        "deps": {
            "openrouter": "ok" if provider.configured() and not production_fake else "unavailable",
            "libreoffice": "ok" if libreoffice else "unavailable",
            "tempDisk": "ok" if disk_ok else "pressure",
            "internalAuth": "ok" if os.getenv("AI_INTERNAL_TOKEN") else "unset",
        },
        "fakeProvider": fake_enabled(),
    }


@app.post("/internal/materials/exam")
async def material_exam(request: ProcessExamRequest, x_ai_internal_token: str | None = Header(default=None)):
    _internal_token(x_ai_internal_token)
    async with worker_slot:
        _resource_gate()
        workdir = Path(tempfile.mkdtemp(prefix="job-", dir=TEMP_ROOT))
        os.chmod(workdir, 0o700)
        try:
            result = await process_exam(request, workdir)
            if _directory_size(workdir) > JOB_TEMP_LIMIT:
                raise PipelineError(
                    "AI_JOB_TEMP_LIMIT",
                    "AI processing exceeded its temporary disk limit",
                    503,
                    result.get("usageEvents", []),
                )
            return result
        finally:
            shutil.rmtree(workdir, ignore_errors=True)


def _workdir(job_id: str) -> Path:
    if not JOB_ID.fullmatch(job_id):
        raise PipelineError("INVALID_INTERNAL_REQUEST", "Invalid AI job identifier", 422)
    return TEMP_ROOT / f"job-{job_id.lower()}"


async def _post_callback(
    request: ProcessMaterialJobRequest | GradeExamRequest,
    suffix: str,
    payload: dict,
    timeout_seconds: float = 30,
) -> None:
    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(
                f"{str(request.callbacks.baseUrl).rstrip('/')}/{suffix}",
                headers={"X-AI-Internal-Token": request.callbacks.token},
                json={"leaseToken": request.callbacks.leaseToken, **payload},
            )
    except httpx.HTTPError as exc:
        raise PipelineError("AI_CALLBACK_UNAVAILABLE", "AI job state could not be persisted", 503) from exc
    if response.is_success:
        return
    try:
        error_body = response.json()
        if isinstance(error_body.get("message"), dict):
            error_body = error_body["message"]
    except (ValueError, AttributeError):
        error_body = {}
    code = error_body.get("code") if isinstance(error_body, dict) else None
    if code == "AI_COST_LIMIT_EXCEEDED":
        raise PipelineError(code, "The configured AI cost limit was reached", 503)
    if response.status_code in (401, 403, 409):
        raise PipelineError("JOB_CANCELLED", "The AI job lease is no longer active", 409)
    raise PipelineError("AI_CALLBACK_UNAVAILABLE", "AI job state could not be persisted", 503)


async def _persist_usage(
    request: ProcessMaterialJobRequest | GradeExamRequest, workdir: Path, event: UsageEvent
) -> None:
    # Write the small accounting event before crossing the network. If the API
    # is temporarily unavailable, the next lease replays this spool before it
    # makes another provider request. No prompt or material body is written.
    path = workdir / f"usage-{event.eventId}.json"
    temporary = workdir / f".{path.name}.tmp"
    temporary.write_text(
        json.dumps(event.model_dump(), separators=(",", ":")), encoding="utf-8"
    )
    os.chmod(temporary, 0o600)
    temporary.replace(path)
    try:
        await _post_callback(request, "usage", {"event": event.model_dump()})
    except PipelineError as error:
        if error.code != "AI_CALLBACK_UNAVAILABLE":
            raise
        # Keep the accounting fact but allow the validated provider response
        # to reach the local stage checkpoint before the worker yields.
        return
    else:
        path.unlink(missing_ok=True)


async def _flush_usage(request: ProcessMaterialJobRequest | GradeExamRequest, workdir: Path) -> None:
    for path in sorted(workdir.glob("usage-*.json")):
        try:
            event = UsageEvent.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            # Never silently discard an immutable cost fact. Atomic writes make
            # this exceptional; retaining the file keeps cleanup fail-closed
            # for operator inspection instead of pretending it was persisted.
            raise PipelineError(
                "AI_USAGE_SPOOL_CORRUPT",
                "Provider accounting could not be replayed safely",
                503,
            ) from error
        await _post_callback(request, "usage", {"event": event.model_dump()})
        path.unlink(missing_ok=True)


def _spooled_usage_cost(workdir: Path) -> int:
    total = 0
    for path in workdir.glob("usage-*.json"):
        try:
            event = UsageEvent.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        total += event.costMicroUsd or 0
    return total


def _budgeted_usage_sink(
    request: ProcessMaterialJobRequest | GradeExamRequest,
    workdir: Path,
):
    # The API subtracts already-persisted cost before dispatch. Include any
    # unacknowledged local spool from the previous lease so a callback outage
    # cannot reset the remaining per-job budget.
    spent_micro_usd = _spooled_usage_cost(workdir)
    limit_micro_usd = request.budgetMicroUsd

    def ensure_budget() -> None:
        if limit_micro_usd is not None and spent_micro_usd > limit_micro_usd:
            raise PipelineError(
                "AI_COST_LIMIT_EXCEEDED",
                "The configured AI cost limit was reached",
                503,
            )

    async def persist(event: UsageEvent) -> None:
        nonlocal spent_micro_usd
        await _persist_usage(request, workdir, event)
        spent_micro_usd += event.costMicroUsd or 0
        ensure_budget()

    return persist, ensure_budget


def _clear_process_files(workdir: Path) -> None:
    for child in workdir.iterdir():
        if (child.name.startswith("usage-") and child.suffix == ".json") or child.name == LOCAL_CHECKPOINT:
            continue
        if child.is_dir():
            shutil.rmtree(child, ignore_errors=True)
        else:
            child.unlink(missing_ok=True)


def _write_local_checkpoint(workdir: Path, stage: str, payload: dict) -> None:
    value = {"checkpointStage": stage, **payload}
    temporary = workdir / f".{LOCAL_CHECKPOINT}.tmp"
    temporary.write_text(json.dumps(value, separators=(",", ":")), encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(workdir / LOCAL_CHECKPOINT)
    os.utime(workdir, None)


def _read_local_checkpoint(workdir: Path) -> dict | None:
    path = workdir / LOCAL_CHECKPOINT
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        path.unlink(missing_ok=True)
        return None
    stage = value.get("checkpointStage") if isinstance(value, dict) else None
    return value if stage in CHECKPOINT_RANK else None


def _best_checkpoint(remote: dict | None, local: dict | None) -> dict | None:
    if not local:
        return remote
    if not remote:
        return local
    remote_rank = CHECKPOINT_RANK.get(str(remote.get("checkpointStage")), 0)
    local_rank = CHECKPOINT_RANK.get(str(local.get("checkpointStage")), 0)
    return local if local_rank >= remote_rank else remote


RETRYABLE_PIPELINE_CODES = {
    "AI_WORKER_TIMEOUT",
    "AI_CALLBACK_UNAVAILABLE",
    "AI_TEMP_DISK_PRESSURE",
    "OPENROUTER_UNREACHABLE",
    "OPENROUTER_RATE_LIMIT",
    "OPENROUTER_FAILED",
    "OPENROUTER_ZDR_UNAVAILABLE",
}


async def _run_material_job(request: ProcessMaterialJobRequest) -> None:
    workdir = _workdir(request.jobId)
    callback_finished = False
    try:
        async with worker_slot:
            _resource_gate()
            workdir.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(workdir, 0o700)
            os.utime(workdir, None)
            request = request.model_copy(update={
                "checkpoint": _best_checkpoint(
                    request.checkpoint, _read_local_checkpoint(workdir)
                )
            })
            usage_sink, ensure_budget = _budgeted_usage_sink(request, workdir)
            await _flush_usage(request, workdir)
            ensure_budget()
            await asyncio.to_thread(_clear_process_files, workdir)

            async def checkpoint_sink(stage: str, payload: dict) -> None:
                try:
                    await asyncio.to_thread(
                        _write_local_checkpoint, workdir, stage, payload
                    )
                except OSError as error:
                    raise PipelineError(
                        "AI_TEMP_DISK_PRESSURE",
                        "AI processing could not persist its retry checkpoint",
                        503,
                    ) from error

            try:
                async with asyncio.timeout(JOB_TIMEOUT_SECONDS):
                    result = await process_material_job(
                        request,
                        workdir,
                        usage_sink=usage_sink,
                        checkpoint_sink=checkpoint_sink,
                    )
            except TimeoutError as error:
                raise PipelineError(
                    "AI_WORKER_TIMEOUT",
                    "AI processing reached its bounded execution time; resume from the latest checkpoint",
                    503,
                ) from error
            if _directory_size(workdir) > JOB_TEMP_LIMIT:
                raise PipelineError("AI_JOB_TEMP_LIMIT", "AI processing exceeded its temporary disk limit", 503)
            # Completion is not allowed to erase an unacknowledged provider
            # cost. Any remaining spool is replayed before the final artifact.
            await _flush_usage(request, workdir)
            await _post_callback(request, "complete", {"result": result}, timeout_seconds=60)
            callback_finished = True
    except asyncio.CancelledError:
        # The cancel endpoint owns the final purge. Keep the usage spool until
        # it has acknowledged every already-incurred provider cost to the API.
        # This also leaves a restart-safe 0700 directory when that callback is
        # temporarily unavailable.
        callback_finished = False
        return
    except PipelineError as error:
        if error.code == "JOB_CANCELLED":
            callback_finished = True
            return
        if error.code == "AI_CALLBACK_UNAVAILABLE":
            # An unacknowledged accounting/checkpoint callback must not be
            # converted into a terminal failure: doing so can delete the local
            # usage spool before the API has recorded provider cost. Leave the
            # lease and 0700 work directory for the reconciler to replay.
            return
        retryable = error.code in RETRYABLE_PIPELINE_CODES
        try:
            await _flush_usage(request, workdir)
            await _post_callback(request, "fail", {
                "code": error.code,
                "message": error.safe_message,
                "retryable": retryable,
            })
            callback_finished = True
        except PipelineError as callback_error:
            # The API/reconciler retains the authoritative lease and retries
            # after expiry. The local spool is intentionally left for replay.
            if callback_error.code in {"JOB_CANCELLED", "AI_COST_LIMIT_EXCEEDED"}:
                # These responses are raised only after the API has already
                # persisted the usage event and closed the authoritative job.
                callback_finished = True
    except Exception:
        try:
            await _flush_usage(request, workdir)
            await _post_callback(request, "fail", {
                "code": "AI_SYSTEM_FAILURE",
                "message": "AI processing failed",
                "retryable": False,
            })
            callback_finished = True
        except PipelineError:
            pass
    finally:
        key = (request.jobId, request.callbacks.leaseToken)
        if active_jobs.get(key) is asyncio.current_task():
            active_jobs.pop(key, None)
        if callback_finished:
            shutil.rmtree(workdir, ignore_errors=True)
        elif workdir.exists():
            os.utime(workdir, None)


@app.post("/internal/materials/jobs", status_code=status.HTTP_202_ACCEPTED)
async def material_job(
    request: ProcessMaterialJobRequest,
    x_ai_internal_token: str | None = Header(default=None),
):
    _internal_token(x_ai_internal_token)
    _resource_gate()
    active_key = (request.jobId, request.callbacks.leaseToken)
    replayed = active_key in active_jobs
    if request.jobId in cancelled_jobs:
        return {"accepted": True, "replayed": True}
    if not replayed:
        active_jobs[active_key] = asyncio.create_task(
            _run_material_job(request), name=f"material-ai-{request.jobId}"
        )
    return {"accepted": True, "replayed": replayed}


@app.post("/internal/materials/jobs/{job_id}/cancel", status_code=status.HTTP_202_ACCEPTED)
async def cancel_material_job(
    job_id: str,
    body: CancelMaterialJobRequest,
    x_ai_internal_token: str | None = Header(default=None),
):
    _internal_token(x_ai_internal_token)
    workdir = _workdir(job_id)
    requested_lease = body.leaseToken
    cancelled_jobs[job_id] = time.time() + max(300, RESUME_TTL_SECONDS)
    matches = [
        task for (active_id, lease), task in tuple(active_jobs.items())
        if active_id == job_id and (not requested_lease or lease == requested_lease)
    ]
    for task in matches:
        task.cancel()
    await asyncio.to_thread(cancel_workdir_processes, workdir)
    if matches:
        await asyncio.gather(*matches, return_exceptions=True)
    # A provider response may have arrived just before cancellation. Usage is
    # spooled before its callback, so flush those immutable accounting facts
    # while the deleting job and matching lease still exist. If the API is
    # unreachable, do not claim purge success or discard the spool; the
    # durable cleanup reconciler will retry this endpoint.
    usage_paths = sorted(workdir.glob("usage-*.json")) if workdir.exists() else []
    if usage_paths:
        if not requested_lease:
            return {"accepted": True, "purged": False}
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                for path in usage_paths:
                    try:
                        event = UsageEvent.model_validate_json(path.read_text(encoding="utf-8"))
                    except (OSError, ValueError):
                        return {"accepted": True, "purged": False}
                    response = await client.post(
                        f"{str(body.callbackBaseUrl).rstrip('/')}/usage",
                        headers={"X-AI-Internal-Token": body.callbackToken},
                        json={"leaseToken": requested_lease, "event": event.model_dump()},
                    )
                    if not response.is_success:
                        try:
                            error_body = response.json()
                            if isinstance(error_body.get("message"), dict):
                                error_body = error_body["message"]
                        except (ValueError, AttributeError):
                            error_body = {}
                        # The API raises this only after the event is stored and
                        # the cost circuit is closed, so the spool is safe to ack.
                        if not isinstance(error_body, dict) or error_body.get("code") != "AI_COST_LIMIT_EXCEEDED":
                            return {"accepted": True, "purged": False}
                    path.unlink(missing_ok=True)
        except (httpx.HTTPError, OSError):
            return {"accepted": True, "purged": False}
    await asyncio.to_thread(shutil.rmtree, workdir, True)
    return {"accepted": True, "purged": not workdir.exists()}


@app.post("/internal/exams/grade")
async def exam_grade(request: GradeExamRequest, x_ai_internal_token: str | None = Header(default=None)):
    _internal_token(x_ai_internal_token)
    async with worker_slot:
        return await grade_exam(request)


async def _run_exam_grading(request: GradeExamRequest) -> None:
    if request.callbacks is None:
        return
    workdir = _workdir(request.attemptId)
    callback_finished = False
    result_path = workdir / "grading-result.json"
    try:
        async with worker_slot:
            _resource_gate()
            workdir.mkdir(parents=True, exist_ok=True, mode=0o700)
            os.chmod(workdir, 0o700)
            os.utime(workdir, None)
            usage_sink, ensure_budget = _budgeted_usage_sink(request, workdir)
            await _flush_usage(request, workdir)
            ensure_budget()
            result: dict | None = None
            candidates: list[object] = []
            if result_path.exists():
                try:
                    candidates.append(json.loads(result_path.read_text(encoding="utf-8")))
                except (OSError, ValueError):
                    result_path.unlink(missing_ok=True)
            if isinstance(request.checkpoint, dict) and "result" in request.checkpoint:
                candidates.append(request.checkpoint["result"])
            for candidate in candidates:
                if not isinstance(candidate, dict):
                    continue
                try:
                    result = GradingWorkerResult.model_validate({
                        "subjectiveScore": candidate.get("subjectiveScore"),
                        "results": candidate.get("results"),
                    }).model_dump()
                    break
                except ValueError:
                    continue
            if result is None:
                try:
                    async with asyncio.timeout(GRADING_TIMEOUT_SECONDS):
                        generated = await grade_exam(
                            request,
                            usage_sink=usage_sink,
                        )
                except TimeoutError as error:
                    raise PipelineError(
                        "AI_GRADING_TIMEOUT", "AI grading reached its bounded execution time", 503
                    ) from error
                result = GradingWorkerResult.model_validate({
                    "subjectiveScore": generated.get("subjectiveScore"),
                    "results": generated.get("results"),
                }).model_dump()
                # Retain only the validated grading result until the API
                # acknowledges completion. This prevents a callback outage
                # from paying for and executing the same grading twice.
                result_path.write_text(
                    json.dumps(result, separators=(",", ":")), encoding="utf-8"
                )
            # The validated result is durable locally before provider facts
            # cross the network. A callback outage can therefore replay both
            # accounting and completion without paying to grade twice.
            await _post_callback(
                request, "checkpoint", {"payload": {"result": result}}, timeout_seconds=30
            )
            await _flush_usage(request, workdir)
            await _post_callback(request, "complete", {"result": result}, timeout_seconds=60)
            callback_finished = True
    except asyncio.CancelledError:
        # Application shutdown can interrupt grading after the provider has
        # returned but before usage/completion callbacks are acknowledged.
        # Preserve the atomic usage spool and validated grading result so the
        # next lease can replay them without paying to grade twice.
        callback_finished = False
        return
    except PipelineError as error:
        if error.code == "JOB_CANCELLED":
            callback_finished = True
        elif error.code != "AI_CALLBACK_UNAVAILABLE":
            try:
                await _flush_usage(request, workdir)
                await _post_callback(
                    request,
                    "fail",
                    {"code": error.code, "message": error.safe_message},
                )
                callback_finished = True
            except PipelineError as callback_error:
                if callback_error.code in {"JOB_CANCELLED", "AI_COST_LIMIT_EXCEEDED"}:
                    callback_finished = True
    except Exception:
        # The caller already received 202, so persist a stable terminal result
        # unhandled exception. Persist a stable terminal result so the lease
        # cannot spin forever on an unexpected parser/serialization defect.
        try:
            await _flush_usage(request, workdir)
            await _post_callback(
                request,
                "fail",
                {"code": "AI_GRADING_FAILED", "message": "AI grading failed"},
            )
            callback_finished = True
        except PipelineError:
            pass
    finally:
        key = (request.attemptId, request.callbacks.leaseToken)
        if active_jobs.get(key) is asyncio.current_task():
            active_jobs.pop(key, None)
        if callback_finished:
            shutil.rmtree(workdir, ignore_errors=True)
        elif workdir.exists():
            os.utime(workdir, None)


@app.post("/internal/exams/jobs", status_code=status.HTTP_202_ACCEPTED)
async def exam_grading_job(
    request: GradeExamRequest,
    x_ai_internal_token: str | None = Header(default=None),
):
    _internal_token(x_ai_internal_token)
    _resource_gate()
    if request.callbacks is None:
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_INTERNAL_REQUEST", "message": "Grading callbacks are required"},
        )
    active_key = (request.attemptId, request.callbacks.leaseToken)
    replayed = active_key in active_jobs
    if not replayed:
        active_jobs[active_key] = asyncio.create_task(
            _run_exam_grading(request), name=f"exam-grading-{request.attemptId}"
        )
    return {"accepted": True, "replayed": replayed}
