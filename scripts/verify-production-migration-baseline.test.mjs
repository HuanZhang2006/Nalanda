import assert from "node:assert/strict";
import test from "node:test";

import {
  BASELINE_VERSIONS,
  classifyMigrationHistory,
  parseStorageBuckets,
  verifyStorageBuckets,
  verifyStorageSchema,
} from "./verify-production-migration-baseline.mjs";

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
