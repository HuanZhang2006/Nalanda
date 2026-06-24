// 应用 supabase/migrations 下所有迁移（按文件名顺序）到 Supabase。
// 迁移均为幂等（create ... if not exists / drop policy if exists + create），可重复执行。
// 用法： SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/db-push.mjs
//   可选： SUPABASE_PROJECT_REF=xxxx（默认下方常量）
import fs from "node:fs";
import path from "node:path";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF || "xsjlmyarvyloktoclvwn";
if (!TOKEN) {
  console.error("缺少 SUPABASE_ACCESS_TOKEN（Supabase 控制台 → Account → Access Tokens）");
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
