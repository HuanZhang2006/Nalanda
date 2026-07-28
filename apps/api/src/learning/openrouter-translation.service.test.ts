import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayTimeoutException, HttpException } from "@nestjs/common";
import { OpenRouterTranslationService } from "./openrouter-translation.service";

const sessionId = "11111111-1111-4111-8111-111111111111";
const wordId = "22222222-2222-4222-8222-222222222222";
const attemptId = "33333333-3333-4333-8333-333333333333";

function result(correct = true) {
  return {
    attemptId,
    correct,
    expected: ["苹果", "一种水果"],
    feedback: correct ? "The meaning matches." : "The meaning does not match.",
    revision: correct ? 4 : 5,
    replayed: false,
    attemptResult: null,
  };
}

function harness() {
  const learning = {
    claimSpellingTranslationAssessment: vi.fn().mockResolvedValue({
      claimed: true,
      term: "apple",
      translations: ["苹果", "一种水果"],
    }),
    completeSpellingTranslationAssessment: vi.fn().mockResolvedValue(result()),
    releaseSpellingTranslationAssessment: vi.fn().mockResolvedValue(true),
    spellingTranslationAssessmentResult: vi.fn().mockReturnValue(result()),
  };
  const flags = { spellingTranslation: vi.fn() };
  return {
    learning,
    flags,
    service: new OpenRouterTranslationService(learning as any, flags as any),
  };
}

function request(answer = "一种常见水果") {
  return { attemptId, expectedRevision: 4, wordId, answer };
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of [
    "OPENROUTER_API_KEY",
    "OPENROUTER_MODEL",
    "OPENROUTER_BASE_URL",
    "OPENROUTER_TIMEOUT_MS",
    "OPENROUTER_ASSESSMENTS_PER_MINUTE",
    "OPENROUTER_ASSESSMENTS_PER_DAY",
    "OPENROUTER_FAKE",
    "PUBLIC_ORIGIN",
  ]) delete process.env[name];
});

describe("OpenRouter spelling translation adapter", () => {
  it("uses structured output, completes the claimed decision, and never persists the raw answer", async () => {
    process.env.OPENROUTER_API_KEY = "test-secret";
    process.env.PUBLIC_ORIGIN = "https://nalanda.online";
    const { service, learning, flags } = harness();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        correct: true,
        feedback: "This paraphrase expresses the accepted meaning.",
      }) } }],
      usage: { prompt_tokens: 41, completion_tokens: 13, total_tokens: 54 },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(service.assess("user-a", sessionId, request())).resolves.toEqual(result());
    expect(flags.spellingTranslation).toHaveBeenCalledOnce();
    expect(learning.claimSpellingTranslationAssessment).toHaveBeenCalledWith(
      "user-a", sessionId, wordId, attemptId, 4,
      expect.stringMatching(/^[0-9a-f]{64}$/), expect.any(String), 22, 20, 200,
    );
    const providerRequest = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse(String((providerRequest[1] as RequestInit).body));
    expect(body.model).toBe("google/gemma-4-26b-a4b-it:free");
    expect(body.max_tokens).toBe(24);
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.required).toEqual(["correct"]);
    expect(body.response_format.json_schema.schema.properties).toEqual({
      correct: { type: "boolean" },
    });
    expect(body.messages[1].content).toContain("一种常见水果");
    expect(JSON.stringify(body)).not.toContain("test-secret");
    expect(learning.completeSpellingTranslationAssessment).toHaveBeenCalledWith(
      "user-a", sessionId, wordId, attemptId, 4,
      expect.stringMatching(/^[0-9a-f]{64}$/), expect.any(String),
      expect.objectContaining({
        correct: true,
        provider: "openrouter",
        model: "google/gemma-4-26b-a4b-it:free",
        usage: { promptTokens: 41, completionTokens: 13, totalTokens: 54 },
      }),
    );
    const serializedDatabaseCall = JSON.stringify(
      learning.completeSpellingTranslationAssessment.mock.calls[0],
    );
    expect(serializedDatabaseCall).not.toContain("一种常见水果");
  });

  it("replays a completed assessment without calling the provider again", async () => {
    process.env.OPENROUTER_API_KEY = "test-secret";
    const { service, learning } = harness();
    learning.claimSpellingTranslationAssessment.mockResolvedValue({
      replayed: true,
      response_payload: { attempt_id: attemptId },
    });
    vi.stubGlobal("fetch", vi.fn());
    await expect(service.assess("user-a", sessionId, request("苹果")))
      .resolves.toMatchObject({ attemptId, replayed: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(learning.completeSpellingTranslationAssessment).not.toHaveBeenCalled();
    expect(learning.spellingTranslationAssessmentResult).toHaveBeenCalledWith({
      attempt_id: attemptId,
    });
  });

  it("accepts a normalized exact translation without a fallible provider call", async () => {
    process.env.OPENROUTER_API_KEY = "test-secret";
    const { service, learning } = harness();
    vi.stubGlobal("fetch", vi.fn());

    await expect(service.assess("user-a", sessionId, request("  苹果  ")))
      .resolves.toEqual(result());
    expect(fetch).not.toHaveBeenCalled();
    expect(learning.completeSpellingTranslationAssessment).toHaveBeenCalledWith(
      "user-a", sessionId, wordId, attemptId, 4,
      expect.stringMatching(/^[0-9a-f]{64}$/), expect.any(String),
      expect.objectContaining({
        correct: true,
        feedback: "The meaning matches an accepted translation.",
        provider: "nalanda-normalized-exact",
        model: "normalized-exact-v1",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      }),
    );
    expect(learning.releaseSpellingTranslationAssessment).not.toHaveBeenCalled();
  });

  it("supplies safe feedback for the provider's boolean-only verdict", async () => {
    process.env.OPENROUTER_API_KEY = "test-secret";
    const { service, learning } = harness();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        correct: true,
      }) } }],
      usage: { prompt_tokens: 202, completion_tokens: 10, total_tokens: 212 },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(service.assess("user-a", sessionId, request("probe-0")))
      .resolves.toEqual(result());
    expect(learning.completeSpellingTranslationAssessment).toHaveBeenCalledWith(
      "user-a", sessionId, wordId, attemptId, 4,
      expect.stringMatching(/^[0-9a-f]{64}$/), expect.any(String),
      expect.objectContaining({
        correct: true,
        feedback: "The meaning matches an accepted translation.",
        usage: { promptTokens: 202, completionTokens: 10, totalTokens: 212 },
      }),
    );
    expect(learning.releaseSpellingTranslationAssessment).not.toHaveBeenCalled();
  });

  it("accepts OpenRouter text-part content and supplies safe incorrect feedback", async () => {
    process.env.OPENROUTER_API_KEY = "test-secret";
    const { service, learning } = harness();
    learning.completeSpellingTranslationAssessment.mockResolvedValue(result(false));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{
        message: {
          content: [{ type: "text", text: JSON.stringify({ correct: false }) }],
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } })));

    await expect(service.assess("user-a", sessionId, request("vehicle")))
      .resolves.toEqual(result(false));
    expect(learning.completeSpellingTranslationAssessment).toHaveBeenCalledWith(
      "user-a", sessionId, wordId, attemptId, 4,
      expect.stringMatching(/^[0-9a-f]{64}$/), expect.any(String),
      expect.objectContaining({
        correct: false,
        feedback: "The meaning does not match the accepted translations.",
      }),
    );
  });

  it("retries one malformed 200 response inside the original timeout budget", async () => {
    process.env.OPENROUTER_API_KEY = "test-secret";
    const { service, learning } = harness();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { reasoning: "provider returned no content" } }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          correct: true,
        }) } }],
      }), { status: 200 })));

    await expect(service.assess("user-a", sessionId, request("probe-0")))
      .resolves.toEqual(result());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(learning.completeSpellingTranslationAssessment).toHaveBeenCalledOnce();
    expect(learning.releaseSpellingTranslationAssessment).not.toHaveBeenCalled();
  });

  it("returns a retryable pending response while another identical request owns the lease", async () => {
    process.env.OPENROUTER_API_KEY = "test-secret";
    const { service, learning } = harness();
    learning.claimSpellingTranslationAssessment.mockResolvedValue({
      pending: true,
      retry_after_ms: 800,
    });
    await expect(service.assess("user-a", sessionId, request("苹果"))).rejects.toMatchObject({
      status: 425,
      response: { code: "TRANSLATION_ASSESSMENT_PENDING" },
    } satisfies Partial<HttpException>);
    expect(learning.completeSpellingTranslationAssessment).not.toHaveBeenCalled();
  });

  it("releases the lease and records no attempt when OpenRouter times out", async () => {
    process.env.OPENROUTER_API_KEY = "test-secret";
    const { service, learning } = harness();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timeout", "TimeoutError")));
    await expect(service.assess("user-a", sessionId, request("一种常见的果实")))
      .rejects.toBeInstanceOf(GatewayTimeoutException);
    expect(learning.releaseSpellingTranslationAssessment).toHaveBeenCalledWith(
      "user-a", attemptId, expect.any(String), "TRANSLATION_PROVIDER_TIMEOUT",
    );
    expect(learning.completeSpellingTranslationAssessment).not.toHaveBeenCalled();
  });

  it("rejects malformed provider JSON and releases the assessment for a safe retry", async () => {
    process.env.OPENROUTER_API_KEY = "test-secret";
    const { service, learning } = harness();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({
        choices: [{ message: { content: "not-json" } }],
      }), { status: 200 })));
    await expect(service.assess("user-a", sessionId, request("一种常见的果实"))).rejects.toMatchObject({
      response: { code: "TRANSLATION_PROVIDER_INVALID" },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(learning.releaseSpellingTranslationAssessment).toHaveBeenCalledOnce();
    expect(learning.completeSpellingTranslationAssessment).not.toHaveBeenCalled();
  });

  it("validates answer length before claiming database state or calling the provider", async () => {
    process.env.OPENROUTER_API_KEY = "test-secret";
    const { service, learning } = harness();
    await expect(service.assess("user-a", sessionId, request(" "))).rejects.toMatchObject({
      response: { code: "INVALID_TRANSLATION_ANSWER" },
    });
    expect(learning.claimSpellingTranslationAssessment).not.toHaveBeenCalled();
  });
});
