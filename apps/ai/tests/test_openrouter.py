import json
from unittest.mock import AsyncMock

import pytest
import respx
from httpx import Response

from app import openrouter
from app.errors import PipelineError
from app.openrouter import TEXT_MODEL, OpenRouterClient
from app.schemas import AuditResult


@pytest.mark.asyncio
@respx.mock
async def test_openrouter_requires_strict_schema_zdr_and_no_tools(monkeypatch):
    monkeypatch.delenv("MATERIAL_AI_FAKE_PROVIDER", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-only-key")
    route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
        return_value=Response(
            200,
            json={
                "id": "request-1",
                "choices": [
                    {
                        "message": {
                            "content": json.dumps(
                                {
                                    "classification": "safe",
                                    "rationale": "ok",
                                    "failedRanges": [],
                                    "injectionLocations": [],
                                }
                            )
                        }
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15, "cost": 0.000002},
            },
        )
    )

    result, usage = await OpenRouterClient().structured(
        purpose="parse_audit",
        model=TEXT_MODEL,
        schema_name="audit",
        result_type=AuditResult,
        system="fixed",
        user_content="untrusted",
        max_tokens=100,
    )

    payload = route.calls.last.request.content
    body = json.loads(payload)
    assert result.classification == "safe"
    assert body["tool_choice"] == "none"
    assert body["reasoning"] == {"enabled": False}
    assert body["response_format"]["json_schema"]["strict"] is True
    assert body["provider"] == {
        "zdr": True,
        "data_collection": "deny",
        "require_parameters": True,
        "sort": "throughput",
        "allow_fallbacks": True,
    }
    assert len(usage) == 1
    assert usage[0].requestId == "request-1"
    assert usage[0].costMicroUsd == 2


@pytest.mark.asyncio
@respx.mock
async def test_openrouter_retries_429_with_retry_after_and_same_model_provider_failover(monkeypatch):
    monkeypatch.delenv("MATERIAL_AI_FAKE_PROVIDER", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-only-key")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_MAX_ATTEMPTS", "2")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_RETRY_BASE_SECONDS", "1")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_RETRY_MAX_SECONDS", "10")
    sleep = AsyncMock()
    monkeypatch.setattr(openrouter.asyncio, "sleep", sleep)
    route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
        side_effect=[
            Response(429, headers={"Retry-After": "7"}, json={"error": {"code": 429}}),
            Response(
                200,
                json={
                    "id": "request-after-retry",
                    "choices": [{"message": {"content": json.dumps({
                        "classification": "safe",
                        "rationale": "ok",
                        "failedRanges": [],
                        "injectionLocations": [],
                    })}}],
                    "usage": {"prompt_tokens": 4, "completion_tokens": 3, "total_tokens": 7, "cost": 0},
                },
            ),
        ]
    )

    result, usage = await OpenRouterClient().structured(
        purpose="parse_audit",
        model=TEXT_MODEL,
        schema_name="audit",
        result_type=AuditResult,
        system="fixed",
        user_content="untrusted",
        max_tokens=100,
    )

    assert result.classification == "safe"
    assert [event.status for event in usage] == ["failed", "succeeded"]
    assert usage[0].errorCode == "OPENROUTER_RATE_LIMIT"
    assert usage[1].requestId == "request-after-retry"
    assert route.call_count == 2
    sleep.assert_awaited_once_with(7.0)
    for call in route.calls:
        payload = json.loads(call.request.content)
        assert payload["provider"]["allow_fallbacks"] is True
        assert payload["provider"]["zdr"] is True
        assert payload["provider"]["data_collection"] == "deny"
        assert payload["provider"]["sort"] == "throughput"
        assert payload["reasoning"] == {"enabled": False}
        assert "models" not in payload


@pytest.mark.asyncio
@respx.mock
async def test_openrouter_exhausted_rate_limit_preserves_each_failed_attempt(monkeypatch):
    monkeypatch.delenv("MATERIAL_AI_FAKE_PROVIDER", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-only-key")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_MAX_ATTEMPTS", "3")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_RETRY_BASE_SECONDS", "0")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_RETRY_MAX_SECONDS", "0")
    monkeypatch.setattr(openrouter.asyncio, "sleep", AsyncMock())
    route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
        return_value=Response(429, json={"error": {"code": 429}})
    )

    with pytest.raises(PipelineError) as caught:
        await OpenRouterClient().structured(
            purpose="parse_audit",
            model=TEXT_MODEL,
            schema_name="audit",
            result_type=AuditResult,
            system="fixed",
            user_content="untrusted",
            max_tokens=100,
        )

    assert caught.value.code == "OPENROUTER_RATE_LIMIT"
    assert route.call_count == 3
    assert len(caught.value.usage_events) == 3
    assert {event["errorCode"] for event in caught.value.usage_events} == {"OPENROUTER_RATE_LIMIT"}


@pytest.mark.asyncio
@respx.mock
async def test_openrouter_does_not_retry_non_retryable_zdr_failure(monkeypatch):
    monkeypatch.delenv("MATERIAL_AI_FAKE_PROVIDER", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-only-key")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_MAX_ATTEMPTS", "4")
    sleep = AsyncMock()
    monkeypatch.setattr(openrouter.asyncio, "sleep", sleep)
    route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
        return_value=Response(400, json={"error": {"code": 400}})
    )

    with pytest.raises(PipelineError) as caught:
        await OpenRouterClient().structured(
            purpose="parse_audit",
            model=TEXT_MODEL,
            schema_name="audit",
            result_type=AuditResult,
            system="fixed",
            user_content="untrusted",
            max_tokens=100,
        )

    assert caught.value.code == "OPENROUTER_ZDR_UNAVAILABLE"
    assert route.call_count == 1
    sleep.assert_not_awaited()


@pytest.mark.asyncio
@respx.mock
async def test_openrouter_fails_closed_when_retry_after_exceeds_bounded_wait(monkeypatch):
    monkeypatch.delenv("MATERIAL_AI_FAKE_PROVIDER", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-only-key")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_MAX_ATTEMPTS", "4")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_RETRY_BASE_SECONDS", "2")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_RETRY_MAX_SECONDS", "60")
    sleep = AsyncMock()
    monkeypatch.setattr(openrouter.asyncio, "sleep", sleep)
    route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
        return_value=Response(429, headers={"Retry-After": "120"}, json={"error": {"code": 429}})
    )

    with pytest.raises(PipelineError) as caught:
        await OpenRouterClient().structured(
            purpose="parse_audit",
            model=TEXT_MODEL,
            schema_name="audit",
            result_type=AuditResult,
            system="fixed",
            user_content="untrusted",
            max_tokens=100,
        )

    assert caught.value.code == "OPENROUTER_RATE_LIMIT"
    assert route.call_count == 1
    assert len(caught.value.usage_events) == 1
    sleep.assert_not_awaited()


@pytest.mark.asyncio
@respx.mock
async def test_openrouter_retries_share_one_total_timeout_budget(monkeypatch):
    monkeypatch.delenv("MATERIAL_AI_FAKE_PROVIDER", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-only-key")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_TIMEOUT_SECONDS", "5")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_MAX_ATTEMPTS", "4")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_RETRY_BASE_SECONDS", "2")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_RETRY_MAX_SECONDS", "60")
    sleep = AsyncMock()
    monkeypatch.setattr(openrouter.asyncio, "sleep", sleep)
    route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
        return_value=Response(429, json={"error": {"code": 429}})
    )
    client = OpenRouterClient()
    monotonic_values = iter([0.0, 1.0, 4.5])
    monkeypatch.setattr(client, "_now", lambda: next(monotonic_values))

    with pytest.raises(PipelineError) as caught:
        await client.structured(
            purpose="parse_audit",
            model=TEXT_MODEL,
            schema_name="audit",
            result_type=AuditResult,
            system="fixed",
            user_content="untrusted",
            max_tokens=100,
        )

    assert caught.value.code == "OPENROUTER_RATE_LIMIT"
    assert route.call_count == 1
    sleep.assert_not_awaited()


@pytest.mark.asyncio
async def test_openrouter_wall_clock_timeout_cancels_a_slow_streaming_request(monkeypatch):
    monkeypatch.delenv("MATERIAL_AI_FAKE_PROVIDER", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-only-key")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_TIMEOUT_SECONDS", "0.02")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_MAX_ATTEMPTS", "1")

    async def slow_post(*_args, **_kwargs):
        await openrouter.asyncio.sleep(1)
        return Response(200, json={})

    monkeypatch.setattr(openrouter.httpx.AsyncClient, "post", slow_post)

    with pytest.raises(PipelineError) as caught:
        await OpenRouterClient().structured(
            purpose="parse_audit",
            model=TEXT_MODEL,
            schema_name="audit",
            result_type=AuditResult,
            system="fixed",
            user_content="untrusted",
            max_tokens=100,
        )

    assert caught.value.code == "OPENROUTER_UNREACHABLE"
    assert len(caught.value.usage_events) == 1


@pytest.mark.asyncio
@respx.mock
async def test_openrouter_retries_empty_structured_output_and_preserves_its_cost(monkeypatch):
    monkeypatch.delenv("MATERIAL_AI_FAKE_PROVIDER", raising=False)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-only-key")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_MAX_ATTEMPTS", "2")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_RETRY_BASE_SECONDS", "0")
    monkeypatch.setenv("MATERIAL_AI_PROVIDER_RETRY_MAX_SECONDS", "0")
    monkeypatch.setattr(openrouter.asyncio, "sleep", AsyncMock())
    route = respx.post("https://openrouter.ai/api/v1/chat/completions").mock(
        side_effect=[
            Response(
                200,
                json={
                    "id": "empty-request",
                    "choices": [{"message": {"content": None}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 4, "completion_tokens": 5, "total_tokens": 9, "cost": 0.000001},
                },
            ),
            Response(
                200,
                json={
                    "id": "valid-request",
                    "choices": [{"message": {"content": json.dumps({
                        "classification": "safe",
                        "rationale": "ok",
                        "failedRanges": [],
                        "injectionLocations": [],
                    })}}],
                    "usage": {"prompt_tokens": 4, "completion_tokens": 3, "total_tokens": 7, "cost": 0.000002},
                },
            ),
        ]
    )

    result, usage = await OpenRouterClient().structured(
        purpose="parse_audit",
        model=TEXT_MODEL,
        schema_name="audit",
        result_type=AuditResult,
        system="fixed",
        user_content="untrusted",
        max_tokens=100,
    )

    assert result.classification == "safe"
    assert route.call_count == 2
    assert [event.errorCode for event in usage] == ["AI_EMPTY_CONTENT", None]
    assert [event.costMicroUsd for event in usage] == [1, 2]


@pytest.mark.asyncio
async def test_fake_provider_emits_idempotent_usage_before_returning(monkeypatch):
    monkeypatch.setenv("MATERIAL_AI_FAKE_PROVIDER", "true")
    persisted = []

    async def sink(event):
        persisted.append(event)

    result, usage = await OpenRouterClient(usage_sink=sink).structured(
        purpose="parse_audit",
        model=TEXT_MODEL,
        schema_name="audit",
        result_type=AuditResult,
        system="fixed",
        user_content="untrusted",
        max_tokens=100,
        fake_value={
            "classification": "safe",
            "rationale": "ok",
            "failedRanges": [],
            "injectionLocations": [],
        },
    )

    assert result.classification == "safe"
    assert persisted == usage
    assert len(persisted[0].eventId) == 36
