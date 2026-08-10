import assert from "node:assert/strict";
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
