import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Materials AI resource canary exercises near-limit full Office rendering", async () => {
  const source = await readFile("scripts/material-ai-resource-canary.py", "utf8");
  assert.match(source, /range\(220\)/);
  assert.match(source, /parse_material\(source, work, source\.name\)/);
  assert.match(source, /parsed\.pageCount < 200/);
  assert.match(source, /character_count < 300_000/);
  assert.match(source, /childPeakRssBytes/);
  assert.match(source, /tempBytes/);
});
