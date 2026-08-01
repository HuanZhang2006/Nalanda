import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("production OpenRouter installer preserves unrelated values and replaces managed keys", async () => {
  const root = await mkdtemp(join(tmpdir(), "nalanda-openrouter-env-"));
  const envFile = join(root, ".env");
  await writeFile(envFile, [
    "SUPABASE_URL=https://example.supabase.co",
    "OPENROUTER_API_KEY=stale",
    "OPENROUTER_MODEL=stale",
    "FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED=false",
    "",
  ].join("\n"), { mode: 0o600 });
  const testKey = `sk-or-v1-${"a".repeat(64)}`;
  const installed = spawnSync("bash", ["scripts/install-production-openrouter-env.sh", root], {
    cwd: process.cwd(),
    input: `${testKey}\n`,
    encoding: "utf8",
  });
  assert.equal(installed.status, 0, installed.stderr);
  assert.doesNotMatch(installed.stdout + installed.stderr, new RegExp(testKey));
  const content = await readFile(envFile, "utf8");
  assert.match(content, /SUPABASE_URL=https:\/\/example\.supabase\.co/);
  assert.match(content, /FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED=true/);
  assert.match(content, /OPENROUTER_MODEL=google\/gemma-4-26b-a4b-it:free/);
  assert.match(content, /OPENROUTER_ASSESSMENTS_PER_DAY=500/);
  assert.equal(content.match(/^OPENROUTER_API_KEY=/gm)?.length, 1);
  assert.ok(content.includes(`OPENROUTER_API_KEY=${testKey}`));
  assert.equal((await stat(envFile)).mode & 0o777, 0o600);
});
