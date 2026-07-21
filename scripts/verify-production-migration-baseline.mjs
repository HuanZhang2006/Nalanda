#!/usr/bin/env node
// Validate the only migration-history states accepted by the production release
// and the Storage objects that schema diff cannot reliably compare.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BASELINE_VERSIONS = Object.freeze([
  "20260620000001",
  "20260624000002",
  "20260624000003",
  "20260624000004",
  "20260625000005",
  "20260625000006",
  "20260625000007",
]);

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function migrationVersions(migrationsDirectory) {
  return fs.readdirSync(migrationsDirectory)
    .map((name) => name.match(/^(\d{14})_[a-z0-9_]+\.sql$/)?.[1])
    .filter(Boolean)
    .sort();
}

export function parseMigrationList(output) {
  const rows = [];
  const normalized = output
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replaceAll("│", "|");

  for (const line of normalized.split(/\r?\n/)) {
    const columns = line.split("|");
    if (columns.length < 2) continue;
    const local = columns[0].match(/\b\d{14}\b/)?.[0] ?? null;
    const remote = columns[1].match(/\b\d{14}\b/)?.[0] ?? null;
    if (local || remote) rows.push({ local, remote });
  }
  return rows;
}

export function classifyMigrationHistory(output, expectedLocalVersions) {
  const rows = parseMigrationList(output);
  const local = rows.map((row) => row.local).filter(Boolean);
  const remote = rows.map((row) => row.remote).filter(Boolean);

  if (!sameValues(local, expectedLocalVersions)) {
    throw new Error(
      `migration list local column does not match the repository: expected ${expectedLocalVersions.join(",")}; got ${local.join(",") || "<empty>"}`,
    );
  }
  if (!sameValues(expectedLocalVersions.slice(0, BASELINE_VERSIONS.length), BASELINE_VERSIONS)) {
    throw new Error("repository migration prefix no longer matches the reviewed 0001-0007 baseline");
  }
  if (remote.length === 0) return "empty";
  if (!sameValues(remote, expectedLocalVersions.slice(0, remote.length))) {
    throw new Error(`remote migration history is not a contiguous local prefix: ${remote.join(",")}`);
  }
  if (remote.length < BASELINE_VERSIONS.length) {
    throw new Error(`remote migration history contains a partial baseline: ${remote.join(",")}`);
  }
  return "established";
}

function policyStatement(schemaSql, name) {
  const normalized = schemaSql.replaceAll('"', "").replace(/\s+/g, " ");
  const statement = normalized.match(new RegExp(`CREATE POLICY ${name} ON storage\\.objects [^;]+;`, "i"))?.[0];
  if (!statement) throw new Error(`missing Storage policy: ${name}`);
  return statement;
}

export function verifyStorageSchema(schemaSql) {
  const policies = [
    ["materials_obj_select", "materials", "FOR SELECT", "USING"],
    ["materials_obj_insert", "materials", "FOR INSERT", "WITH CHECK"],
    ["materials_obj_delete", "materials", "FOR DELETE", "USING"],
    ["media_insert_own", "community-media", "FOR INSERT", "WITH CHECK"],
    ["media_delete_own", "community-media", "FOR DELETE", "USING"],
  ];

  for (const [name, bucket, operation, predicate] of policies) {
    const statement = policyStatement(schemaSql, name);
    for (const required of [
      operation,
      "TO authenticated",
      predicate,
      `bucket_id = '${bucket}'::text`,
      "storage.foldername",
      "auth.uid()",
    ]) {
      if (!statement.includes(required)) {
        throw new Error(`Storage policy ${name} is missing expected clause: ${required}`);
      }
    }
  }
}

export function parseStorageBuckets(dataSql) {
  const normalized = dataSql.replaceAll('"', "");
  const copy = normalized.match(/COPY\s+storage\.buckets\s*\(([^)]+)\)\s+FROM stdin;\r?\n([\s\S]*?)\r?\n\\\./i);
  if (!copy) throw new Error("storage.buckets COPY block was not found");

  const columns = copy[1].split(",").map((value) => value.trim());
  const idIndex = columns.indexOf("id");
  const nameIndex = columns.indexOf("name");
  const publicIndex = columns.indexOf("public");
  if ([idIndex, nameIndex, publicIndex].some((index) => index < 0)) {
    throw new Error("storage.buckets dump is missing id, name, or public");
  }

  return copy[2]
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const values = line.split("\t");
      return {
        id: values[idIndex],
        name: values[nameIndex],
        public: values[publicIndex],
      };
    });
}

export function verifyStorageBuckets(dataSql) {
  const buckets = parseStorageBuckets(dataSql);
  const expectations = new Map([
    ["materials", "f"],
    ["community-media", "t"],
  ]);

  for (const [id, expectedPublic] of expectations) {
    const bucket = buckets.find((candidate) => candidate.id === id);
    if (!bucket) throw new Error(`missing Storage bucket: ${id}`);
    if (bucket.name !== id || ![expectedPublic, expectedPublic === "t" ? "true" : "false"].includes(bucket.public)) {
      throw new Error(`Storage bucket ${id} has an unexpected name or public setting`);
    }
  }
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === "history" && args.length === 2) {
    const [historyFile, migrationsDirectory] = args;
    const state = classifyMigrationHistory(
      fs.readFileSync(historyFile, "utf8"),
      migrationVersions(migrationsDirectory),
    );
    process.stdout.write(`${state}\n`);
    return;
  }
  if (command === "storage" && args.length === 2) {
    verifyStorageSchema(fs.readFileSync(args[0], "utf8"));
    verifyStorageBuckets(fs.readFileSync(args[1], "utf8"));
    process.stdout.write("Storage baseline verification passed.\n");
    return;
  }
  throw new Error(
    "usage: verify-production-migration-baseline.mjs history <list.txt> <migrations-dir> | storage <schema.sql> <data.sql>",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
