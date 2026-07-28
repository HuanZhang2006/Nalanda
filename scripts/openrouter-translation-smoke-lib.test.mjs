import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOpenRouterSmokeBody,
  parseOpenRouterSmokePayload,
} from "./openrouter-translation-smoke-lib.mjs";

test("OpenRouter smoke uses the pinned model and strict two-case schema", () => {
  const body = buildOpenRouterSmokeBody();
  assert.equal(body.model, "google/gemma-4-26b-a4b-it:free");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.schema.properties.decisions.minItems, 2);
  assert.doesNotMatch(JSON.stringify(body), /api[_-]?key/i);
});

test("OpenRouter smoke accepts the expected structured semantic decisions", () => {
  assert.deepEqual(parseOpenRouterSmokePayload({
    choices: [{ message: { content: JSON.stringify({ decisions: [
      { id: "semantic-match", correct: true },
      { id: "semantic-mismatch", correct: false },
    ] }) } }],
    usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
  }), { promptTokens: 20, completionTokens: 8, totalTokens: 28 });
  assert.throws(() => parseOpenRouterSmokePayload({
    choices: [{ message: { content: JSON.stringify({ decisions: [
      { id: "semantic-match", correct: false },
      { id: "semantic-mismatch", correct: false },
    ] }) } }],
  }), /did not match/);
});
