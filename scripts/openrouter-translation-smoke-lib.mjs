export const DEFAULT_OPENROUTER_TRANSLATION_MODEL = "google/gemma-4-26b-a4b-it:free";

export function buildOpenRouterSmokeBody(model = DEFAULT_OPENROUTER_TRANSLATION_MODEL) {
  return {
    model,
    temperature: 0,
    max_tokens: 160,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "nalanda_translation_smoke",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            decisions: {
              type: "array",
              minItems: 2,
              maxItems: 2,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string", enum: ["semantic-match", "semantic-mismatch"] },
                  correct: { type: "boolean" },
                },
                required: ["id", "correct"],
              },
            },
          },
          required: ["decisions"],
        },
      },
    },
    messages: [
      {
        role: "system",
        content: [
          "Judge whether each learner translation expresses at least one accepted meaning.",
          "Accept synonyms and natural paraphrases, but reject unrelated meanings.",
          "Return only the requested structured result.",
        ].join(" "),
      },
      {
        role: "user",
        content: JSON.stringify([
          {
            id: "semantic-match",
            englishTerm: "apple",
            acceptedTranslations: ["苹果", "一种水果"],
            learnerTranslation: "一种常见的红色或绿色水果",
          },
          {
            id: "semantic-mismatch",
            englishTerm: "apple",
            acceptedTranslations: ["苹果", "一种水果"],
            learnerTranslation: "用于驾驶的车辆",
          },
        ]),
      },
    ],
  };
}

export function parseOpenRouterSmokePayload(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("OpenRouter response has no message content");
  let parsed;
  try {
    parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    throw new Error("OpenRouter response is not valid JSON");
  }
  const decisions = Array.isArray(parsed?.decisions) ? parsed.decisions : [];
  const byId = new Map(decisions.map((entry) => [entry?.id, entry?.correct]));
  if (byId.get("semantic-match") !== true || byId.get("semantic-mismatch") !== false) {
    throw new Error("OpenRouter semantic decisions did not match the release fixture");
  }
  return {
    promptTokens: Number.isSafeInteger(payload?.usage?.prompt_tokens)
      ? payload.usage.prompt_tokens : null,
    completionTokens: Number.isSafeInteger(payload?.usage?.completion_tokens)
      ? payload.usage.completion_tokens : null,
    totalTokens: Number.isSafeInteger(payload?.usage?.total_tokens)
      ? payload.usage.total_tokens : null,
  };
}
