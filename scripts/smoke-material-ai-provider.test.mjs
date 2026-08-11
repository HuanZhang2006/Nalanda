import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Materials AI real-provider gate covers fixed formats, ZDR evidence, injection, and grading", async () => {
  const source = await readFile("scripts/smoke-material-ai-provider.py", "utf8");
  assert.match(source, /deepseek\/deepseek-v4-flash-0731/);
  assert.match(source, /xiaomi\/mimo-v2\.5/);
  for (const fixture of ["pdf", "docx", "pptx", "chart", "malicious", "educational"]) {
    assert.match(source, new RegExp(`"${fixture}"`));
  }
  assert.match(source, /PROMPT_INJECTION_REJECTED/);
  assert.match(source, /zdrEnforced/);
  assert.match(source, /costMicroUsd/);
  assert.match(source, /totalTokens/);
  assert.match(source, /SUPABASE_URL}\/storage\/v1\//);
  assert.doesNotMatch(source, /SUPABASE_URL \+ value/);
  assert.match(source, /MATERIAL_AI_FAKE_PROVIDER.*!= "true"/);
  assert.match(source, /safe_worker_failure/);
  assert.match(source, /providerErrorCodes/);
  assert.match(source, /providerPurposes/);
  assert.match(source, /provider purpose never succeeded/);
  assert.match(source, /providerFailures/);
  assert.doesNotMatch(source, /response\.text/);
  assert.match(source, /finally:[\s\S]*clean_storage\(\)/);
  assert.doesNotMatch(source, /print\([^\n]*(SERVICE_KEY|INTERNAL_TOKEN|OPENROUTER_API_KEY)/);
});
