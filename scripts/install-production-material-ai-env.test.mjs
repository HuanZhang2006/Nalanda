import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("Materials AI installer separates worker secrets and starts the public feature closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "nalanda-material-ai-env-"));
  await writeFile(join(root, ".env"), [
    "SUPABASE_URL=https://fixture.supabase.co",
    "SUPABASE_SERVICE_ROLE_KEY=service-secret",
    "AZURE_SPEECH_KEY=azure-secret",
    "FEATURE_MATERIAL_AI=true",
    "FEATURE_MATERIAL_AI_LUNA=true",
    "FEATURE_MATERIAL_AI_OX_ALPHA=true",
    "MATERIAL_AI_LUNA_ALLOWED_EXTENSIONS=pdf,png,jpg,jpeg,webp",
    "MATERIAL_AI_LUNA_DISABLED_REASON_CODE=stale",
    "MATERIAL_AI_OX_ALPHA_DISABLED_REASON_CODE=stale",
    "AI_INTERNAL_TOKEN=stale",
    "",
  ].join("\n"), { mode: 0o600 });
  const key = `sk-or-v1-${"a".repeat(64)}`;
  const token = "b".repeat(64);
  const installed = spawnSync("bash", ["scripts/install-production-material-ai-env.sh", root], {
    cwd: process.cwd(), input: `${key}\n${token}\n`, encoding: "utf8",
  });
  assert.equal(installed.status, 0, installed.stderr);
  assert.doesNotMatch(installed.stdout + installed.stderr, new RegExp(`${key}|${token}|service-secret|azure-secret`));

  const api = await readFile(join(root, ".env"), "utf8");
  const worker = await readFile(join(root, ".ai.env"), "utf8");
  assert.match(api, /^FEATURE_MATERIAL_AI=false$/m);
  assert.match(api, /^FEATURE_MATERIAL_AI_LUNA=false$/m);
  assert.doesNotMatch(api, /OX_ALPHA/);
  assert.match(api, /^MATERIAL_AI_LUNA_ALLOWED_EXTENSIONS=pdf,png$/m);
  assert.match(api, /^MATERIAL_AI_LUNA_DISABLED_REASON_CODE=AI_LUNA_DISABLED$/m);
  assert.doesNotMatch(api, /^MATERIAL_AI_LUNA_DISABLED_REASON_CODE=stale$/m);
  assert.match(api, /^AI_SERVICE_URL=http:\/\/ai:8000$/m);
  assert.match(api, /^MATERIAL_AI_RESUME_TTL_SECONDS=86400$/m);
  assert.match(api, new RegExp(`^AI_INTERNAL_TOKEN=${token}$`, "m"));
  assert.match(api, /^SUPABASE_SERVICE_ROLE_KEY=service-secret$/m);
  assert.match(worker, new RegExp(`^OPENROUTER_API_KEY=${key}$`, "m"));
  assert.match(worker, new RegExp(`^AI_INTERNAL_TOKEN=${token}$`, "m"));
  assert.match(worker, /^SUPABASE_URL=https:\/\/fixture\.supabase\.co$/m);
  assert.match(worker, /^MATERIAL_AI_LUNA_ALLOWED_EXTENSIONS=pdf,png$/m);
  assert.doesNotMatch(worker, /OX_ALPHA/);
  assert.match(worker, /^MATERIAL_AI_PROVIDER_MAX_ATTEMPTS=4$/m);
  assert.match(worker, /^MATERIAL_AI_JOB_TIMEOUT_SECONDS=1200$/m);
  assert.match(worker, /^MATERIAL_AI_GRADING_TIMEOUT_SECONDS=240$/m);
  assert.match(worker, /^MATERIAL_AI_PROVIDER_RETRY_BASE_SECONDS=2$/m);
  assert.match(worker, /^MATERIAL_AI_PROVIDER_RETRY_MAX_SECONDS=60$/m);
  assert.match(worker, /^MATERIAL_AI_KNOWLEDGE_MAX_TOKENS=30000$/m);
  assert.match(worker, /^MATERIAL_AI_RESUME_TTL_SECONDS=86400$/m);
  assert.doesNotMatch(worker, /SUPABASE_SERVICE_ROLE_KEY|AZURE_SPEECH_KEY|REDIS_URL/);
  assert.equal((await stat(join(root, ".env"))).mode & 0o777, 0o600);
  assert.equal((await stat(join(root, ".ai.env"))).mode & 0o777, 0o600);
});
