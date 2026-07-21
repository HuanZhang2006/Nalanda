import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function writeExecutable(file, contents) {
  fs.writeFileSync(file, contents, { mode: 0o755 });
}

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nalanda-backup-test-"));
  const bin = path.join(directory, "bin");
  fs.mkdirSync(bin);

  writeExecutable(path.join(bin, "supabase"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--version") { console.log("2.101.0"); process.exit(0); }
if (args[0] === "link") process.exit(0);
if (args[0] !== "db" || args[1] !== "dump") process.exit(2);
const file = args[args.indexOf("--file") + 1];
const schemaIndex = args.indexOf("--schema");
if (schemaIndex >= 0 && args[schemaIndex + 1] === "supabase_migrations") {
  if (process.env.HISTORY_DUMP_ERROR === "generic") {
    console.error("connection unexpectedly closed");
  } else {
    console.error("pg_dump: error: no matching schemas were found");
  }
  process.exit(1);
}
fs.writeFileSync(file, "-- non-empty fake Supabase dump\\n");
`);

  writeExecutable(path.join(bin, "openssl"), `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args.includes("-d")) {
  process.stdout.write(fs.readFileSync(args[args.indexOf("-in") + 1]));
} else {
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => fs.writeFileSync(args[args.indexOf("-out") + 1], Buffer.concat(chunks)));
}
`);

  return { directory, bin };
}

function runBackup(extraEnv = {}) {
  const { directory, bin } = fixture();
  const output = path.join(directory, "backup.tar.gz.enc");
  const result = spawnSync("bash", ["scripts/create-db-release-backup.sh"], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      ...extraEnv,
      PATH: `${bin}:${process.env.PATH}`,
      SUPABASE_ACCESS_TOKEN: "test-token",
      SUPABASE_DB_PASSWORD: "test-password",
      SUPABASE_PROJECT_REF: "test-project-ref",
      BACKUP_ENCRYPTION_KEY: "test-only-key-that-is-at-least-32-characters",
      BACKUP_OUTPUT: output,
    },
  });
  return { directory, output, result };
}

test("records an absent migration-history schema in a valid recovery archive", () => {
  const { directory, output, result } = runBackup();
  try {
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const extracted = path.join(directory, "extracted");
    fs.mkdirSync(extracted);
    const untar = spawnSync("tar", ["-xzf", output, "-C", extracted], { encoding: "utf8" });
    assert.equal(untar.status, 0, untar.stderr);
    assert.match(fs.readFileSync(path.join(extracted, "MANIFEST"), "utf8"), /migration_history_state=absent/);
    assert.match(
      fs.readFileSync(path.join(extracted, "migration-history-schema.sql"), "utf8"),
      /schema was absent at capture time/,
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("keeps non-absence migration-history dump errors fatal", () => {
  const { directory, output, result } = runBackup({ HISTORY_DUMP_ERROR: "generic" });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /connection unexpectedly closed/);
    assert.equal(fs.existsSync(output), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
