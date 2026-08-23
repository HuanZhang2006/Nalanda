import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/deploy.yml", import.meta.url);

test("every remote compose exec detaches stdin from the activation heredoc", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const marker = "<<'REMOTE'\n";
  const start = workflow.indexOf(marker);
  const end = workflow.indexOf("\n          REMOTE", start);
  assert.ok(start >= 0 && end > start, "protected SSH heredoc must be present");
  const script = workflow.slice(start + marker.length, end)
    .split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");

  assert.match(
    script,
    /compose_exec_no_stdin\(\) \{\n\s+docker compose --env-file "\$next_env" -f "\$next_compose" exec -T "\$@" <\/dev\/null\n\}/,
    "the shared compose exec helper must detach stdin",
  );
  const withoutHelper = script.replace(/compose_exec_no_stdin\(\) \{[\s\S]*?\n\}/, "");
  assert.doesNotMatch(
    withoutHelper,
    /docker compose[^\n]*exec -T/,
    "activation code must not bypass the stdin-safe compose exec helper",
  );
  assert.equal(
    (withoutHelper.match(/compose_exec_no_stdin /g) ?? []).length,
    9,
    "Redis, two AI cleanup checks, and six feature-flag checks must use the helper",
  );

  const verificationOffset = script.indexOf("compose_exec_no_stdin redis");
  const activationOffset = script.indexOf("Release $release_id is healthy and active.");
  assert.ok(activationOffset > verificationOffset, "release activation must follow Redis verification");
});

test("the complete protected remote activation script is valid Bash and rolls back every real-provider gate", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const marker = "<<'REMOTE'\n";
  const start = workflow.indexOf(marker);
  const end = workflow.indexOf("\n          REMOTE", start);
  assert.ok(start >= 0 && end > start, "protected SSH heredoc must be present");
  const script = workflow.slice(start + marker.length, end)
    .split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
  const syntax = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);

  for (const reason of [
    "real Materials AI provider gate failed",
    "real Azure Speech smoke failed",
    "real OpenRouter translation smoke failed",
    "real queued audio/Storage/assessment gate failed",
    "authenticated Materials AI queue/Notes/exam gate failed",
  ]) {
    assert.match(script, new RegExp(`rollback_application "${reason}"`));
  }
  assert.match(
    script,
    /smoke-learning-audio-production\.mjs; then\n\s+docker compose[^\n]+logs --tail=150 api \|\| true/,
    "the audio gate must preserve sanitized candidate API diagnostics before rollback",
  );
});

test("production release preflight reclaims only stale Nalanda artifacts and enforces disk headroom", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const preflightStart = workflow.indexOf("<<'PREFLIGHT'\n");
  const preflightEnd = workflow.indexOf("\n          PREFLIGHT", preflightStart);
  assert.ok(preflightStart >= 0 && preflightEnd > preflightStart);
  const script = workflow.slice(preflightStart + "<<'PREFLIGHT'\n".length, preflightEnd)
    .split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
  const syntax = spawnSync("bash", ["-n"], { input: script, encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);

  assert.match(script, /minimum_free_bytes=6442450944/);
  assert.match(script, /-mmin \+1440/);
  assert.match(script, /nalanda-api:\*.*nalanda-ai:\*/);
  assert.match(script, /NALANDA_\(API\|AI\)_IMAGE/);
  assert.match(script, /grep -Fxq -- "\$image_ref"/);
  assert.match(script, /docker ps -aq --filter "ancestor=\$image_id"/);
  assert.doesNotMatch(script, /docker image prune -a/);
  assert.ok(
    workflow.indexOf("Reclaim stale Nalanda artifacts and verify release disk headroom")
      < workflow.indexOf("Upload release to an isolated incoming directory"),
  );
});

test("failed activation cleans its candidate and restores the previous API without waiting on AI", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const marker = "<<'REMOTE'\n";
  const start = workflow.indexOf(marker);
  const end = workflow.indexOf("\n          REMOTE", start);
  const script = workflow.slice(start + marker.length, end)
    .split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");

  assert.match(script, /trap cleanup_candidate_on_exit EXIT/);
  assert.match(script, /rm -rf -- "\$release" "\$incoming"/);
  assert.match(script, /docker image rm "nalanda-api:\$sha" "nalanda-ai:\$sha"/);
  assert.match(script, /up -d --force-recreate --no-deps api/);
  assert.doesNotMatch(script, /up -d --force-recreate redis ai api/);
  assert.match(script, /Previous API container could not be restarted/);
  assert.match(workflow, /Remove isolated incoming directory after an unsuccessful release[\s\S]*if: failure\(\)/);
});
