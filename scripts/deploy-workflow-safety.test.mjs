import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowPath = new URL("../.github/workflows/deploy.yml", import.meta.url);

test("remote Redis verification cannot consume the remaining activation heredoc", async () => {
  const workflow = await readFile(workflowPath, "utf8");
  const redisVerification = workflow.match(
    /docker compose --env-file "\$next_env"[\s\S]*?exec -T redis sh -ec[\s\S]*?noeviction' \\\n\s*<\/dev\/null/,
  );

  assert.ok(
    redisVerification,
    "docker compose exec must detach stdin so the remaining SSH heredoc reaches the remote shell",
  );

  const verificationOffset = workflow.indexOf(redisVerification[0]);
  const activationOffset = workflow.indexOf("Release $release_id is healthy and active.");
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
