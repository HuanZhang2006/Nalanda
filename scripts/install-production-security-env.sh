#!/usr/bin/env bash
set -Eeuo pipefail

root="${1:-/opt/nalanda}"
env_file="$root/.env"
redis_env_file="$root/.redis.env"
umask 077
IFS= read -r redis_password
IFS= read -r hmac_secret

if [[ ! "$redis_password" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "REDIS_PASSWORD must be a 32-byte hex secret" >&2
  exit 2
fi
if [[ ! "$hmac_secret" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "RATE_LIMIT_HMAC_SECRET must be a 32-byte hex secret" >&2
  exit 2
fi
[[ -f "$env_file" ]] || { echo "Production environment file is missing" >&2; exit 2; }

temporary="$(mktemp "$root/.env.security.XXXXXX")"
redis_temporary="$(mktemp "$root/.redis.env.security.XXXXXX")"
cleanup() { rm -f "$temporary" "$redis_temporary"; }
trap cleanup EXIT

awk '
  !/^(REDIS_PASSWORD|REDIS_URL|RATE_LIMIT_HMAC_SECRET|POINT_ABUSE_SCANNER_ENABLED|POINT_ABUSE_SCAN_INTERVAL_SECONDS)=/
' "$env_file" > "$temporary"
{
  printf 'REDIS_URL=redis://:%s@redis:6379/0\n' "$redis_password"
  printf 'RATE_LIMIT_HMAC_SECRET=%s\n' "$hmac_secret"
  printf 'POINT_ABUSE_SCANNER_ENABLED=true\n'
  printf 'POINT_ABUSE_SCAN_INTERVAL_SECONDS=300\n'
} >> "$temporary"
chmod 600 "$temporary"
printf 'REDIS_PASSWORD=%s\n' "$redis_password" > "$redis_temporary"
chmod 600 "$redis_temporary"
mv "$temporary" "$env_file"
mv "$redis_temporary" "$redis_env_file"
trap - EXIT

echo "Redis and rate-limit secrets installed without printing credentials."
