"""Fixed-model OpenRouter adapter with strict JSON Schema and ZDR routing."""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from .errors import PipelineError
from .schemas import UsageEvent

T = TypeVar("T", bound=BaseModel)
TEXT_MODEL = "deepseek/deepseek-v4-flash-0731"
VISION_MODEL = "xiaomi/mimo-v2.5"
LUNA_MODEL = "openai/gpt-6-luna"
LUNA_PROVIDER = "Azure"
ROUTED_QUANTIZATIONS = ("fp8", "fp16", "bf16", "fp32", "unknown")
# GPT-6 Luna endpoints accept neither sampling temperature nor, on Azure,
# `max_tokens`. With require_parameters=true either one makes OpenRouter find
# no endpoint (HTTP 404), so these models use the supported request shape.
COMPLETION_TOKEN_MODELS = frozenset({LUNA_MODEL})


def fake_enabled() -> bool:
    return os.getenv("MATERIAL_AI_FAKE_PROVIDER", "false").lower() == "true"


class StructuredOutputError(Exception):
    def __init__(self, code: str, safe_message: str):
        super().__init__(safe_message)
        self.code = code
        self.safe_message = safe_message


class OpenRouterClient:
    def __init__(self, usage_sink: Callable[[UsageEvent], Awaitable[None]] | None = None):
        self.api_key = os.getenv("OPENROUTER_API_KEY", "")
        self.base_url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
        self.timeout = float(os.getenv("MATERIAL_AI_PROVIDER_TIMEOUT_SECONDS", "180"))
        self.max_attempts = self._bounded_int("MATERIAL_AI_PROVIDER_MAX_ATTEMPTS", 4, 1, 10)
        self.retry_base_seconds = self._bounded_float("MATERIAL_AI_PROVIDER_RETRY_BASE_SECONDS", 2.0, 0.0, 60.0)
        self.retry_max_seconds = self._bounded_float("MATERIAL_AI_PROVIDER_RETRY_MAX_SECONDS", 60.0, 0.0, 300.0)
        self.usage_sink = usage_sink

    async def _emit(self, event: UsageEvent) -> None:
        if self.usage_sink is not None:
            await self.usage_sink(event)

    def configured(self) -> bool:
        return bool(self.api_key) or fake_enabled()

    async def structured(
        self,
        *,
        purpose: str,
        model: str,
        schema_name: str,
        result_type: type[T],
        system: str,
        user_content: str | list[dict[str, Any]],
        max_tokens: int,
        fake_value: dict[str, Any] | None = None,
        provider_only: list[str] | None = None,
        required_upstream_provider: str | None = None,
        allow_fallbacks: bool = True,
        plugins: list[dict[str, Any]] | None = None,
        reasoning: dict[str, Any] | None = None,
    ) -> tuple[T, list[UsageEvent]]:
        if fake_enabled():
            if fake_value is None:
                raise PipelineError("FAKE_FIXTURE_MISSING", "The fake provider fixture is incomplete", 500)
            # Deterministic browser-only cancellation fixture. Keeping the
            # delay inside the fake adapter makes cancellation exercise a real
            # in-flight await without slowing normal unit or Playwright jobs.
            if "playwright-active-delete" in json.dumps(user_content):
                await asyncio.sleep(8)
            parsed = result_type.model_validate(fake_value)
            event = UsageEvent(
                    purpose=purpose,
                    model=model,
                    requestId="fake",
                    promptTokens=0,
                    completionTokens=0,
                    totalTokens=0,
                    costMicroUsd=0,
                    durationMs=1,
                    zdrEnforced=True,
                    status="succeeded",
                    upstreamProvider=required_upstream_provider or "fake",
                    upstreamEndpoint="fake",
            )
            await self._emit(event)
            return parsed, [event]
        if not self.api_key:
            raise PipelineError("OPENROUTER_NOT_CONFIGURED", "OpenRouter is not configured", 503)

        schema = result_type.model_json_schema()
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
            # This pipeline needs the strict schema result, not a hidden or
            # returned chain of thought. The pinned models expose optional
            # reasoning and otherwise default it on, which can consume the
            # completion budget and leave message.content null.
            "reasoning": reasoning if reasoning is not None else {"enabled": False},
            "tool_choice": "none",
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "strict": True, "schema": schema},
            },
            "provider": {
                "zdr": True,
                "data_collection": "deny",
                "require_parameters": True,
                "sort": "throughput",
                # The top-level `model` remains fixed and no alternate-model
                # list is supplied. Provider failover may therefore only move
                # this same model to another endpoint that still satisfies
                # ZDR, data-collection and parameter filters.
                "allow_fallbacks": True,
            },
        }
        if model in COMPLETION_TOKEN_MODELS:
            payload["max_completion_tokens"] = max_tokens
        else:
            payload["temperature"] = 0
            payload["max_tokens"] = max_tokens
        if provider_only:
            payload["provider"]["only"] = provider_only
            payload["provider"]["allow_fallbacks"] = allow_fallbacks
        else:
            # Routed models may be served by aggressively quantized endpoints.
            # Those have produced runaway strict-JSON streams that hit the
            # output ceiling, so keep routing on fp8-or-better precision.
            payload["provider"]["quantizations"] = list(ROUTED_QUANTIZATIONS)
        if plugins:
            payload["plugins"] = plugins
        started = self._now()
        deadline = started + self.timeout
        response: httpx.Response | None = None
        failed_events: list[UsageEvent] = []
        async with httpx.AsyncClient(timeout=httpx.Timeout(self.timeout)) as client:
            for attempt in range(self.max_attempts):
                attempt_started = self._now()
                remaining = deadline - attempt_started
                if remaining <= 0:
                    raise PipelineError(
                        "OPENROUTER_UNREACHABLE",
                        "The AI provider did not respond within the bounded request time",
                        503,
                        [item.model_dump() for item in failed_events],
                    )
                try:
                    # HTTPX phase timeouts reset while response bytes continue
                    # arriving. The outer deadline is therefore required to
                    # enforce one wall-clock budget across every attempt.
                    async with asyncio.timeout(remaining):
                        response = await client.post(
                            f"{self.base_url}/chat/completions",
                            headers={
                                "Authorization": f"Bearer {self.api_key}",
                                "Content-Type": "application/json",
                                "HTTP-Referer": os.getenv("PUBLIC_APP_URL", "https://nalanda.app"),
                                "X-Title": "Nalanda Materials AI",
                            },
                            json=payload,
                            timeout=httpx.Timeout(max(0.001, remaining)),
                        )
                except (TimeoutError, httpx.TimeoutException, httpx.NetworkError) as exc:
                    event = self._usage(
                        purpose, model, None, attempt_started, "failed", "OPENROUTER_UNREACHABLE"
                    )
                    await self._emit(event)
                    failed_events.append(event)
                    retry_delay = self._retry_delay(attempt, None)
                    remaining = deadline - self._now()
                    if attempt + 1 < self.max_attempts and retry_delay is not None and retry_delay < remaining:
                        await asyncio.sleep(retry_delay)
                        continue
                    raise PipelineError(
                        "OPENROUTER_UNREACHABLE",
                        "The AI provider did not respond",
                        503,
                        [item.model_dump() for item in failed_events],
                    ) from exc

                if response.is_success:
                    try:
                        parsed = self._decode_structured(response, result_type)
                    except StructuredOutputError as exc:
                        event = self._usage(purpose, model, response, attempt_started, "failed", exc.code)
                        await self._emit(event)
                        failed_events.append(event)
                        if not provider_only and event.upstreamProvider:
                            # Throughput sorting keeps choosing the same fast
                            # endpoint. If it produced unusable structured output
                            # (e.g. a runaway stream), route retries elsewhere.
                            slug = self._provider_slug(event.upstreamProvider)
                            ignored = payload["provider"].setdefault("ignore", [])
                            if slug and slug not in ignored:
                                ignored.append(slug)
                        retry_delay = self._retry_delay(attempt, None)
                        remaining = deadline - self._now()
                        if (
                            attempt + 1 < self.max_attempts
                            and retry_delay is not None
                            and retry_delay < remaining
                        ):
                            await asyncio.sleep(retry_delay)
                            continue
                        raise PipelineError(
                            exc.code,
                            exc.safe_message,
                            502,
                            [item.model_dump() for item in failed_events],
                        ) from exc
                    succeeded = self._usage(purpose, model, response, started, "succeeded", None)
                    await self._emit(succeeded)
                    if (
                        required_upstream_provider
                        and (succeeded.upstreamProvider or "").casefold()
                        != required_upstream_provider.casefold()
                    ):
                        raise PipelineError(
                            "AI_PROVIDER_ROUTING_VIOLATION",
                            "The AI provider did not use the required endpoint",
                            502,
                            [*[item.model_dump() for item in failed_events], succeeded.model_dump()],
                        )
                    return parsed, [*failed_events, succeeded]

                code = self._provider_error_code(response)
                event = self._usage(purpose, model, response, attempt_started, "failed", code)
                await self._emit(event)
                failed_events.append(event)
                retry_delay = self._retry_delay(attempt, response)
                remaining = deadline - self._now()
                if (
                    self._retryable(response.status_code)
                    and attempt + 1 < self.max_attempts
                    and retry_delay is not None
                    and retry_delay < remaining
                ):
                    await asyncio.sleep(retry_delay)
                    continue
                raise PipelineError(
                    code,
                    "No compliant AI provider endpoint was available",
                    503,
                    [item.model_dump() for item in failed_events],
                )

        raise PipelineError(
            "OPENROUTER_FAILED",
            "No compliant AI provider endpoint was available",
            503,
            [item.model_dump() for item in failed_events],
        )

    @staticmethod
    def _decode_structured(response: httpx.Response, result_type: type[T]) -> T:
        try:
            body = response.json()
            choice = body["choices"][0]
            message = choice["message"]
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise StructuredOutputError("AI_BAD_JSON", "The AI provider returned invalid JSON") from exc
        if choice.get("finish_reason") == "length":
            raise StructuredOutputError("AI_OUTPUT_TRUNCATED", "The AI provider truncated the structured output")
        content = message.get("content")
        if isinstance(content, list):
            content = "".join(
                item.get("text", "")
                for item in content
                if isinstance(item, dict) and isinstance(item.get("text"), str)
            )
        if not isinstance(content, str) or not content.strip():
            raise StructuredOutputError("AI_EMPTY_CONTENT", "The AI provider returned no structured output")
        try:
            decoded = json.loads(content)
        except json.JSONDecodeError as exc:
            raise StructuredOutputError("AI_BAD_JSON", "The AI provider returned invalid JSON") from exc
        try:
            return result_type.model_validate(decoded)
        except ValidationError as exc:
            raise StructuredOutputError(
                "AI_SCHEMA_INVALID", "The AI provider output did not match the required schema"
            ) from exc

    def _retry_delay(self, attempt: int, response: httpx.Response | None) -> float | None:
        delay = min(self.retry_max_seconds, self.retry_base_seconds * (2**attempt))
        if response is None:
            return delay
        raw_retry_after = response.headers.get("Retry-After")
        if raw_retry_after is None:
            return delay
        try:
            retry_after = max(0.0, float(raw_retry_after))
        except ValueError:
            return delay
        # Do not retry earlier than the provider requested. If the requested
        # delay exceeds this call's bounded wait, fail closed and release the
        # quota reservation. A later user retry keeps the same provider/model.
        if retry_after > self.retry_max_seconds:
            return None
        return max(delay, retry_after)

    @staticmethod
    def _retryable(status_code: int) -> bool:
        return status_code in (408, 429, 502, 503, 504)

    @staticmethod
    def _provider_error_code(response: httpx.Response) -> str:
        status_code = response.status_code
        error_text = ""
        try:
            body = response.json()
            error = body.get("error") if isinstance(body, dict) else None
            if isinstance(error, dict):
                error_text = " ".join(
                    str(value)
                    for key, value in error.items()
                    if key in {"code", "message", "type"}
                    and isinstance(value, (str, int))
                ).casefold()
        except (TypeError, ValueError):
            pass
        if status_code in (400, 404) and any(
            marker in error_text
            for marker in ("zdr", "zero data retention", "data retention policy")
        ):
            return "OPENROUTER_ZDR_UNAVAILABLE"
        if status_code == 400:
            return "OPENROUTER_BAD_REQUEST"
        if status_code == 404:
            return "OPENROUTER_MODEL_UNAVAILABLE"
        if status_code == 429:
            return "OPENROUTER_RATE_LIMIT"
        if status_code == 402:
            return "OPENROUTER_INSUFFICIENT_CREDITS"
        if status_code in (401, 403):
            return "OPENROUTER_AUTH_FAILED"
        return "OPENROUTER_FAILED"

    @staticmethod
    def _provider_slug(name: str) -> str:
        """Map an OpenRouter provider display name to its routing slug."""
        return re.sub(r"[^a-z0-9]+", "-", name.casefold()).strip("-")

    @staticmethod
    def _now() -> float:
        return time.monotonic()

    @staticmethod
    def _bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
        try:
            value = int(os.getenv(name, str(default)))
        except ValueError:
            value = default
        return min(maximum, max(minimum, value))

    @staticmethod
    def _bounded_float(name: str, default: float, minimum: float, maximum: float) -> float:
        try:
            value = float(os.getenv(name, str(default)))
        except ValueError:
            value = default
        return min(maximum, max(minimum, value))

    @staticmethod
    def _usage(
        purpose: str, model: str, response: httpx.Response | None, started: float, status: str, error_code: str | None
    ) -> UsageEvent:
        body: dict[str, Any] = {}
        if response is not None:
            try:
                body = response.json()
            except Exception:
                body = {}
        usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
        raw_provider = body.get("provider")
        upstream_provider = raw_provider if isinstance(raw_provider, str) and raw_provider else None
        if upstream_provider and upstream_provider.casefold() == "openai":
            upstream_provider = "OpenAI"
        elif upstream_provider and upstream_provider.casefold() == "azure":
            # Persist one canonical value so the database completion gate is
            # case-stable while still rejecting every non-Azure Luna provider.
            upstream_provider = "Azure"
        raw_endpoint = body.get("provider_endpoint") or body.get("endpoint")
        upstream_endpoint = raw_endpoint if isinstance(raw_endpoint, str) and raw_endpoint else None
        raw_cost = usage.get("cost")
        try:
            cost_micro = max(0, round(float(raw_cost) * 1_000_000)) if raw_cost is not None else None
        except (TypeError, ValueError):
            cost_micro = None
        return UsageEvent(
            purpose=purpose,
            model=model,
            requestId=(body.get("id") if isinstance(body.get("id"), str) else None),
            promptTokens=usage.get("prompt_tokens") if isinstance(usage.get("prompt_tokens"), int) else None,
            completionTokens=usage.get("completion_tokens")
            if isinstance(usage.get("completion_tokens"), int)
            else None,
            totalTokens=usage.get("total_tokens") if isinstance(usage.get("total_tokens"), int) else None,
            costMicroUsd=cost_micro,
            durationMs=max(0, round((time.monotonic() - started) * 1000)),
            zdrEnforced=True,
            status=status,
            errorCode=error_code,
            upstreamProvider=upstream_provider,
            upstreamEndpoint=upstream_endpoint,
        )
