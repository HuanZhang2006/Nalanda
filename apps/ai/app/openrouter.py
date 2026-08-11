"""Fixed-model OpenRouter adapter with strict JSON Schema and ZDR routing."""

from __future__ import annotations

import json
import os
import time
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from .errors import PipelineError
from .schemas import UsageEvent

T = TypeVar("T", bound=BaseModel)
TEXT_MODEL = "deepseek/deepseek-v4-flash-0731"
VISION_MODEL = "xiaomi/mimo-v2.5"


def fake_enabled() -> bool:
    return os.getenv("MATERIAL_AI_FAKE_PROVIDER", "false").lower() == "true"


class OpenRouterClient:
    def __init__(self):
        self.api_key = os.getenv("OPENROUTER_API_KEY", "")
        self.base_url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
        self.timeout = float(os.getenv("MATERIAL_AI_PROVIDER_TIMEOUT_SECONDS", "180"))

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
    ) -> tuple[T, UsageEvent]:
        if fake_enabled():
            if fake_value is None:
                raise PipelineError("FAKE_FIXTURE_MISSING", "The fake provider fixture is incomplete", 500)
            return result_type.model_validate(fake_value), UsageEvent(
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
            )
        if not self.api_key:
            raise PipelineError("OPENROUTER_NOT_CONFIGURED", "OpenRouter is not configured", 503)

        schema = result_type.model_json_schema()
        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
            "temperature": 0,
            "max_tokens": max_tokens,
            "tool_choice": "none",
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": schema_name, "strict": True, "schema": schema},
            },
            "provider": {
                "zdr": True,
                "data_collection": "deny",
                "require_parameters": True,
                # Fail closed when the fixed model has no compliant ZDR endpoint.
                # A fallback could silently change retention, capabilities, or cost.
                "allow_fallbacks": False,
            },
        }
        started = time.monotonic()
        response: httpx.Response | None = None
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(self.timeout)) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                        "HTTP-Referer": os.getenv("PUBLIC_APP_URL", "https://nalanda.app"),
                        "X-Title": "Nalanda Materials AI",
                    },
                    json=payload,
                )
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            event = self._usage(purpose, model, None, started, "failed", "OPENROUTER_UNREACHABLE")
            raise PipelineError(
                "OPENROUTER_UNREACHABLE", "The AI provider did not respond", 503, [event.model_dump()]
            ) from exc

        if not response.is_success:
            code = (
                "OPENROUTER_ZDR_UNAVAILABLE"
                if response.status_code in (400, 404)
                else ("OPENROUTER_RATE_LIMIT" if response.status_code == 429 else "OPENROUTER_FAILED")
            )
            event = self._usage(purpose, model, response, started, "failed", code)
            raise PipelineError(code, "No compliant AI provider endpoint was available", 503, [event.model_dump()])

        try:
            body = response.json()
            content = body["choices"][0]["message"]["content"]
            parsed = result_type.model_validate(json.loads(content))
        except (KeyError, IndexError, TypeError, json.JSONDecodeError, ValidationError) as exc:
            event = self._usage(purpose, model, response, started, "failed", "AI_BAD_JSON")
            raise PipelineError(
                "AI_BAD_JSON", "The AI provider returned invalid structured output", 502, [event.model_dump()]
            ) from exc
        return parsed, self._usage(purpose, model, response, started, "succeeded", None)

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
        )
