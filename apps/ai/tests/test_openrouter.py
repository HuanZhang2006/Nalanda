import json

import pytest
import respx
from httpx import Response

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
    assert body["response_format"]["json_schema"]["strict"] is True
    assert body["provider"] == {
        "zdr": True,
        "data_collection": "deny",
        "require_parameters": True,
        "allow_fallbacks": False,
    }
    assert usage.requestId == "request-1"
    assert usage.costMicroUsd == 2
