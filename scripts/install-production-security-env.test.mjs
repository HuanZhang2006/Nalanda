import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("security installer isolates Redis credentials and never prints secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "nalanda-security-env-"));
  const envFile = join(root, ".env");
  await writeFile(envFile, [
    "SUPABASE_URL=https://example.supabase.co",
    "AZURE_SPEECH_KEY=provider-secret",
    "REDIS_PASSWORD=stale",
    "RATE_LIMIT_HMAC_SECRET=stale",
    "",
  ].join("\n"), { mode: 0o600 });
  const redisPassword = "a".repeat(64);
  const hmacSecret = "b".repeat(64);
  const installed = spawnSync("bash", ["scripts/install-production-security-env.sh", root], {
    cwd: process.cwd(),
    input: `${redisPassword}\n${hmacSecret}\n`,
    encoding: "utf8",
  });
  assert.equal(installed.status, 0, installed.stderr);
  assert.doesNotMatch(installed.stdout + installed.stderr, new RegExp(redisPassword));
  assert.doesNotMatch(installed.stdout + installed.stderr, new RegExp(hmacSecret));

  const apiEnv = await readFile(envFile, "utf8");
  assert.match(apiEnv, /SUPABASE_URL=https:\/\/example\.supabase\.co/);
  assert.match(apiEnv, /AZURE_SPEECH_KEY=provider-secret/);
  assert.ok(apiEnv.includes(`REDIS_URL=redis://:${redisPassword}@redis:6379/0`));
  assert.ok(apiEnv.includes(`RATE_LIMIT_HMAC_SECRET=${hmacSecret}`));
  assert.doesNotMatch(apiEnv, /^REDIS_PASSWORD=/m);
  assert.equal((await stat(envFile)).mode & 0o777, 0o600);

  const redisEnv = await readFile(join(root, ".redis.env"), "utf8");
  assert.equal(redisEnv, `REDIS_PASSWORD=${redisPassword}\n`);
  assert.doesNotMatch(redisEnv, /SUPABASE|AZURE|HMAC/);
  assert.equal((await stat(join(root, ".redis.env"))).mode & 0o777, 0o600);
});

test("nginx installer preserves the site and adds both rate-limit layers", async () => {
  const root = await mkdtemp(join(tmpdir(), "nalanda-nginx-rate-"));
  const site = join(root, "nalanda.conf");
  const zones = join(root, "zones.conf");
  const installedZones = join(root, "installed-zones.conf");
  const fakeNginx = join(root, "nginx");
  await writeFile(site, `server {
    listen 80;
    server_name nalanda.online;
    location /api/ {
        proxy_pass http://127.0.0.1:8411;
    }
}
`);
  await writeFile(zones, "limit_req_zone $binary_remote_addr zone=nalanda_api:10m rate=20r/s;\n");
  await writeFile(fakeNginx, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await chmod(fakeNginx, 0o755);

  const installed = spawnSync("bash", ["scripts/install-production-nginx-rate-limits.sh", zones, site], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NALANDA_NGINX_ZONE_TARGET: installedZones,
      NALANDA_NGINX_BIN: fakeNginx,
    },
    encoding: "utf8",
  });
  assert.equal(installed.status, 0, installed.stderr);
  const content = await readFile(site, "utf8");
  assert.match(content, /location = \/api\/auth\/register/);
  assert.match(content, /limit_req zone=nalanda_register burst=3 nodelay/);
  assert.match(content, /limit_req zone=nalanda_api burst=40 nodelay/);
  assert.match(content, /error_page 429 = @nalanda_register_limited/);
  assert.match(content, /error_page 429 = @nalanda_api_limited/);
  assert.match(content, /"code":"RATE_LIMITED"/);
  assert.match(content, /RateLimit-Remaining "0"/);
  assert.equal(await readFile(installedZones, "utf8"), await readFile(zones, "utf8"));
});
