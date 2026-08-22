import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Materials AI real-provider gate covers fixed formats, ZDR evidence, injection, and grading", async () => {
  const source = await readFile("scripts/smoke-material-ai-provider.py", "utf8");
  assert.match(source, /deepseek\/deepseek-v4-flash-0731/);
  assert.match(source, /xiaomi\/mimo-v2\.5/);
  assert.match(source, /openai\/gpt-5\.6-luna/);
  assert.match(source, /api\/v1\/endpoints\/zdr/);
  assert.match(source, /MATERIAL_AI_ALLOW_LUNA_DISABLED/);
  assert.match(source, /OPENROUTER_ZDR_UNAVAILABLE/);
  assert.match(source, /luna_native_file_v1/);
  assert.match(source, /upstreamProvider.*OpenAI/s);
  assert.match(source, /sourceMode.*native_file/s);
  assert.match(source, /native pipeline unexpectedly created DocumentIR/);
  for (const fixture of ["pdf", "docx", "pptx", "chart", "malicious", "educational"]) {
    assert.match(source, new RegExp(`"${fixture}"`));
  }
  assert.match(source, /PROMPT_INJECTION_REJECTED/);
  assert.match(source, /kind": "knowledge_graph"/);
  assert.match(source, /\/internal\/materials\/jobs/);
  assert.match(source, /knowledgeGraphNodes/);
  assert.match(source, /zdrEnforced/);
  assert.match(source, /costMicroUsd/);
  assert.match(source, /totalTokens/);
  assert.match(source, /SUPABASE_URL}\/storage\/v1\//);
  assert.doesNotMatch(source, /SUPABASE_URL \+ value/);
  assert.match(source, /MATERIAL_AI_FAKE_PROVIDER.*!= "true"/);
  assert.match(source, /safe_worker_failure/);
  assert.match(source, /providerErrorCodes/);
  assert.match(source, /providerPurposes/);
  assert.match(source, /validationDiagnostics/);
  assert.match(source, /finalSemanticCategories/);
  assert.match(source, /Spaced practice distributes study sessions/);
  assert.match(source, /provider purpose never succeeded/);
  assert.match(source, /providerFailures/);
  assert.doesNotMatch(source, /response\.text/);
  assert.match(source, /finally:[\s\S]*clean_storage\(\)/);
  assert.doesNotMatch(source, /print\([^\n]*(SERVICE_KEY|INTERNAL_TOKEN|OPENROUTER_API_KEY)/);
});
