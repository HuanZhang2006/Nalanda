// Legacy emergency tool: replays every SQL file under supabase/migrations through the Management API.
// Normal releases must use the Supabase CLI migration history (see DATABASE_RELEASE_ROLLBACK.md).
// This script does not maintain the remote migration ledger or provide cross-file transactions; manual emergency use only.
// Usage: SUPABASE_ACCESS_TOKEN=sbp_xxx SUPABASE_PROJECT_REF=xxxx node scripts/db-push.mjs
import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
if (!TOKEN) {
  console.error("Missing SUPABASE_ACCESS_TOKEN (Supabase dashboard → Account → Access Tokens)");
  process.exit(1);
}
if (!REF) {
  console.error("Missing SUPABASE_PROJECT_REF; to prevent accidental pushes, the script no longer has a default project");
  process.exit(1);
}

if (process.env.ALLOW_LEGACY_DB_PUSH !== "YES") {
  console.error(
    "db-push.mjs does not maintain migration history and is for emergencies only. If you have a backup and must use it, set ALLOW_LEGACY_DB_PUSH=YES explicitly.",
  );
  process.exit(1);
}

const dir = "supabase/migrations";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

for (const f of files) {
  const sql = fs.readFileSync(path.join(dir, f), "utf8");
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ query: sql }),
  });
  if (!res.ok) {
    console.error(`${f}: FAILED ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  console.log(`${f}: ok`);
}
console.log("all migrations applied");
