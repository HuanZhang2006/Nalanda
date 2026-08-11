"""Nalanda Materials AI worker. Internal-only; NestJS owns every public API."""

from __future__ import annotations

import asyncio
import hmac
import os
import shutil
import tempfile
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .errors import PipelineError
from .openrouter import OpenRouterClient, fake_enabled
from .pipeline import grade_exam, process_exam
from .schemas import GradeExamRequest, ProcessExamRequest

TEMP_ROOT = Path(os.getenv("MATERIAL_AI_TEMP_ROOT", "/tmp/nalanda-material-ai"))
JOB_TEMP_LIMIT = int(os.getenv("MATERIAL_AI_JOB_TEMP_LIMIT_BYTES", str(1024 * 1024 * 1024)))
MIN_FREE_BYTES = int(os.getenv("MATERIAL_AI_TEMP_MIN_FREE_BYTES", str(512 * 1024 * 1024)))
worker_slot = asyncio.Semaphore(1)


def _ensure_temp_root() -> None:
    TEMP_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(TEMP_ROOT, 0o700)


def _sweep_stale() -> int:
    _ensure_temp_root()
    cutoff = time.time() - 3600
    removed = 0
    for child in TEMP_ROOT.iterdir():
        try:
            if child.is_dir() and child.stat().st_mtime < cutoff:
                shutil.rmtree(child)
                removed += 1
        except OSError:
            continue
    return removed


async def _sweeper() -> None:
    while True:
        await asyncio.sleep(15 * 60)
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


@app.post("/internal/exams/grade")
async def exam_grade(request: GradeExamRequest, x_ai_internal_token: str | None = Header(default=None)):
    _internal_token(x_ai_internal_token)
    async with worker_slot:
        return await grade_exam(request)
