// 旧版应急工具：通过 Management API 重放 supabase/migrations 下的全部 SQL。
// 正常发布必须使用 Supabase CLI 的迁移历史（见 DATABASE_RELEASE_ROLLBACK.md）。
// 本脚本不维护远端迁移账本，也不提供跨文件事务，只允许人工应急使用。
// 用法：SUPABASE_ACCESS_TOKEN=sbp_xxx SUPABASE_PROJECT_REF=xxxx node scripts/db-push.mjs
import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
if (!TOKEN) {
  console.error("缺少 SUPABASE_ACCESS_TOKEN（Supabase 控制台 → Account → Access Tokens）");
  process.exit(1);
}
if (!REF) {
  console.error("缺少 SUPABASE_PROJECT_REF；为防止误发，脚本不再提供默认项目");
  process.exit(1);
}

if (process.env.ALLOW_LEGACY_DB_PUSH !== "YES") {
  console.error(
    "db-push.mjs 不维护迁移历史，仅供应急。确认已备份且必须使用时，显式设置 ALLOW_LEGACY_DB_PUSH=YES。",
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
