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
    5,
    "Redis, two AI cleanup checks, and two feature-flag checks must use the helper",
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
    "authenticated Materials AI queue/Notes/exam gate failed",
  ]) {
    assert.match(script, new RegExp(`rollback_application "${reason}"`));
  }
});
