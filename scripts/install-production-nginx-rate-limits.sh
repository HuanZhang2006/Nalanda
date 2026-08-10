#!/usr/bin/env bash
set -Eeuo pipefail

source_zone="${1:?usage: install-production-nginx-rate-limits.sh ZONE_FILE [SITE_FILE]}"
site="${2:-/etc/nginx/sites-available/nalanda}"
zone_target="${NALANDA_NGINX_ZONE_TARGET:-/etc/nginx/conf.d/nalanda-rate-limit.conf}"
nginx_bin="${NALANDA_NGINX_BIN:-nginx}"
[[ -s "$source_zone" ]] || { echo "nginx rate-limit zone file is missing" >&2; exit 2; }
[[ -s "$site" ]] || { echo "Nalanda nginx site is missing" >&2; exit 2; }

backup_dir="$(mktemp -d /tmp/nalanda-nginx.XXXXXX)"
cleanup() { rm -rf "$backup_dir"; }
trap cleanup EXIT
cp "$site" "$backup_dir/site"
if [[ -f "$zone_target" ]]; then cp "$zone_target" "$backup_dir/zone"; fi

install -m 644 "$source_zone" "$zone_target"
python3 - "$site" <<'PY'
from pathlib import Path
import re
import sys

path = Path(sys.argv[1])
value = path.read_text()
if "zone=nalanda_api" not in value:
    value, count = re.subn(
        r"(location\s+/api/\s*\{)",
        r"\1\n        limit_req zone=nalanda_api burst=40 nodelay;",
        value,
        count=1,
    )
    if count != 1:
        raise SystemExit("could not locate Nalanda /api/ nginx location")
if "error_page 429 = @nalanda_api_limited;" not in value:
    value, count = re.subn(
        r"(limit_req\s+zone=nalanda_api[^;]*;)",
        r"\1\n        error_page 429 = @nalanda_api_limited;",
        value,
        count=1,
    )
    if count != 1:
        raise SystemExit("could not attach the API 429 contract")
if "location = /api/auth/register" not in value:
    marker = re.search(r"^[ \t]*location\s+/api/\s*\{", value, re.MULTILINE)
    if not marker:
        raise SystemExit("could not locate registration insertion point")
    indent = re.match(r"[ \t]*", marker.group(0)).group(0)
    block = f'''{indent}location = /api/auth/register {{
{indent}    limit_req zone=nalanda_register burst=3 nodelay;
{indent}    error_page 429 = @nalanda_register_limited;
{indent}    client_max_body_size 32k;
{indent}    proxy_pass http://127.0.0.1:8411;
{indent}    proxy_http_version 1.1;
{indent}    proxy_set_header Host $host;
{indent}    proxy_set_header X-Real-IP $remote_addr;
{indent}    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
{indent}    proxy_set_header X-Forwarded-Proto $scheme;
{indent}}}

'''
    value = value[:marker.start()] + block + value[marker.start():]
elif "error_page 429 = @nalanda_register_limited;" not in value:
    value, count = re.subn(
        r"(limit_req\s+zone=nalanda_register[^;]*;)",
        r"\1\n        error_page 429 = @nalanda_register_limited;",
        value,
        count=1,
    )
    if count != 1:
        raise SystemExit("could not attach the registration 429 contract")

if "location @nalanda_register_limited" not in value:
    api_location = re.search(r"location\s+/api/\s*\{", value)
    server_starts = list(re.finditer(r"\bserver\s*\{", value[:api_location.start() if api_location else 0]))
    if not api_location or not server_starts:
        raise SystemExit("could not locate the Nalanda API server block")
    opening = value.find("{", server_starts[-1].start())
    depth = 0
    closing = -1
    for index in range(opening, len(value)):
        if value[index] == "{":
            depth += 1
        elif value[index] == "}":
            depth -= 1
            if depth == 0:
                closing = index
                break
    if closing < 0:
        raise SystemExit("could not locate Nalanda server block end")
    named = '''    location @nalanda_register_limited {
        default_type application/json;
        add_header Cache-Control "no-store" always;
        add_header Retry-After "1" always;
        add_header RateLimit-Limit "1" always;
        add_header RateLimit-Remaining "0" always;
        add_header RateLimit-Reset "1" always;
        return 429 '{"code":"RATE_LIMITED","message":"Too many requests","retryAfterSeconds":1}';
    }

    location @nalanda_api_limited {
        default_type application/json;
        add_header Cache-Control "no-store" always;
        add_header Retry-After "1" always;
        add_header RateLimit-Limit "20" always;
        add_header RateLimit-Remaining "0" always;
        add_header RateLimit-Reset "1" always;
        return 429 '{"code":"RATE_LIMITED","message":"Too many requests","retryAfterSeconds":1}';
    }

'''
    value = value[:closing] + named + value[closing:]
path.write_text(value)
PY

rollback() {
  cp "$backup_dir/site" "$site"
  if [[ -f "$backup_dir/zone" ]]; then
    cp "$backup_dir/zone" "$zone_target"
  else
    rm -f "$zone_target"
  fi
}
if ! "$nginx_bin" -t; then
  rollback
  "$nginx_bin" -t || true
  echo "nginx rate-limit configuration failed validation and was restored" >&2
  exit 1
fi
if ! "$nginx_bin" -s reload; then
  rollback
  "$nginx_bin" -t || true
  "$nginx_bin" -s reload || true
  echo "nginx reload failed and the previous configuration was restored" >&2
  exit 1
fi

trap - EXIT
cleanup
echo "Nalanda nginx rate limits installed and validated."
