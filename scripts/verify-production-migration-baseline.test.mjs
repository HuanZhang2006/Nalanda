import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BASELINE_VERSIONS,
  classifyMigrationHistory,
  parseStorageBuckets,
  verifyStorageBuckets,
  verifyStorageSchema,
} from "./verify-production-migration-baseline.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function writeExecutable(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o755 });
}

const allVersions = [...BASELINE_VERSIONS, "20260710000008", "20260721000009", "20260721000010"];

function history(remoteVersions = []) {
  return [
    "LOCAL | REMOTE | TIME (UTC)",
    ...allVersions.map((local, index) => `${local} | ${remoteVersions[index] ?? ""} | 2026-01-01 00:00:00`),
  ].join("\n");
}

test("accepts only an empty history or a contiguous history containing the baseline", () => {
  assert.equal(classifyMigrationHistory(history(), allVersions), "empty");
  assert.equal(classifyMigrationHistory(history(BASELINE_VERSIONS), allVersions), "established");
  assert.equal(classifyMigrationHistory(history(allVersions), allVersions), "established");
  assert.throws(
    () => classifyMigrationHistory(history(BASELINE_VERSIONS.slice(0, -1)), allVersions),
    /partial baseline/,
  );
  assert.throws(
    () => classifyMigrationHistory(history([BASELINE_VERSIONS[0], BASELINE_VERSIONS[2]]), allVersions),
    /contiguous local prefix/,
  );
});

test("rejects a local migration list that differs from the checked-out repository", () => {
  assert.throws(
    () => classifyMigrationHistory(history(), allVersions.slice(0, -1)),
    /does not match the repository/,
  );
});

const storageSchema = `
CREATE POLICY materials_obj_select ON storage.objects FOR SELECT TO authenticated USING ((bucket_id = 'materials'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));
CREATE POLICY materials_obj_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'materials'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));
CREATE POLICY materials_obj_delete ON storage.objects FOR DELETE TO authenticated USING ((bucket_id = 'materials'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));
CREATE POLICY media_insert_own ON storage.objects FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'community-media'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));
CREATE POLICY media_delete_own ON storage.objects FOR DELETE TO authenticated USING ((bucket_id = 'community-media'::text) AND ((storage.foldername(name))[1] = (auth.uid())::text));
`;

const storageData = `
COPY storage.buckets (id, name, owner, created_at, updated_at, public) FROM stdin;
materials\tmaterials\t\\N\t2026-01-01\t2026-01-01\tf
community-media\tcommunity-media\t\\N\t2026-01-01\t2026-01-01\tt
\\.
`;

test("verifies the reviewed Storage policies and bucket visibility", () => {
  verifyStorageSchema(storageSchema);
  verifyStorageBuckets(storageData);
  assert.deepEqual(parseStorageBuckets(storageData), [
    { id: "materials", name: "materials", public: "f" },
    { id: "community-media", name: "community-media", public: "t" },
  ]);
  assert.throws(() => verifyStorageSchema(storageSchema.replace("auth.uid()", "null")), /expected clause/);
  assert.throws(() => verifyStorageBuckets(storageData.replace("materials\tmaterials", "other\tother")), /missing Storage bucket/);
});

test("captures the public schema diff from stdout before repairing an empty history", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nalanda-baseline-test-"));
  try {
    const scripts = path.join(directory, "scripts");
    const migrations = path.join(directory, "supabase", "migrations");
    const bin = path.join(directory, "bin");
    fs.mkdirSync(scripts, { recursive: true });
    fs.mkdirSync(migrations, { recursive: true });
    fs.mkdirSync(bin);

    for (const file of ["prepare-production-migration-baseline.sh", "verify-production-migration-baseline.mjs"]) {
      fs.copyFileSync(path.join(root, "scripts", file), path.join(scripts, file));
    }
    for (const version of allVersions) {
      fs.writeFileSync(path.join(migrations, `${version}_fixture.sql`), `-- ${version}\n`);
    }

    const state = path.join(directory, "history-repaired");
    const commandLog = path.join(directory, "supabase-commands.log");
    writeExecutable(path.join(bin, "supabase"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_SUPABASE_LOG, JSON.stringify(args) + "\\n");
if (args.includes("--output")) {
  console.error("test fixture rejects the CLI format flag --output");
  process.exit(64);
}
if (args[0] === "migration" && args[1] === "list") {
  const repaired = fs.existsSync(process.env.FAKE_SUPABASE_STATE);
  console.log("Local | Remote | Time (UTC)");
  const versions = ${JSON.stringify(allVersions)};
  versions.forEach((version, index) => console.log(version + " | " + (repaired && index < 7 ? version : "") + " | 2026-01-01 00:00:00"));
  process.exit(0);
}
if (args[0] === "db" && args[1] === "diff") process.exit(0);
if (args[0] === "db" && args[1] === "dump") {
  const file = args[args.indexOf("--file") + 1];
  if (args.includes("--data-only")) {
    fs.writeFileSync(file, ${JSON.stringify(storageData)});
  } else {
    fs.writeFileSync(file, ${JSON.stringify(storageSchema)});
  }
  process.exit(0);
}
if (args[0] === "migration" && args[1] === "repair") {
  fs.writeFileSync(process.env.FAKE_SUPABASE_STATE, "repaired\\n");
  process.exit(0);
}
process.exit(2);
`);

    const result = spawnSync("bash", ["scripts/prepare-production-migration-baseline.sh"], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_SUPABASE_LOG: commandLog,
        FAKE_SUPABASE_STATE: state,
      },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const calls = fs.readFileSync(commandLog, "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(calls.some((args) => args.join(" ") === "db diff --linked --schema public --use-migra"));
    assert.ok(calls.some((args) => args[0] === "migration" && args[1] === "repair"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
