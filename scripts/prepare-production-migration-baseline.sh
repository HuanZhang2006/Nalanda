#!/usr/bin/env bash
# Establish the reviewed 0001-0007 migration history only after an encrypted
# production recovery point exists and the live schema matches that baseline.

set -Eeuo pipefail
umask 077

baseline_versions=(
  20260620000001
  20260624000002
  20260624000003
  20260624000004
  20260625000005
  20260625000006
  20260625000007
)
baseline_last="${baseline_versions[${#baseline_versions[@]} - 1]}"

for command_name in supabase node; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "required command not found: ${command_name}" >&2
    exit 2
  }
done

workdir="$(mktemp -d "${TMPDIR:-/tmp}/nalanda-db-baseline.XXXXXX")"
pending_dir="$workdir/pending"
mkdir -p "$pending_dir"

restore_pending_migrations() {
  local staged
  shopt -s nullglob
  for staged in "$pending_dir"/*.sql; do
    mv -- "$staged" "supabase/migrations/$(basename "$staged")"
  done
  shopt -u nullglob
}
cleanup() {
  restore_pending_migrations
  rm -rf "$workdir"
}
trap cleanup EXIT

capture_history() {
  local destination="$1"
  supabase migration list --linked 2>&1 | tee "$destination" >&2
}

history_file="$workdir/history-before.txt"
capture_history "$history_file"
state="$(node scripts/verify-production-migration-baseline.mjs history "$history_file" supabase/migrations)"

if [[ "$state" == "established" ]]; then
  echo "Production migration history already contains the reviewed 0001-0007 baseline."
  exit 0
fi
if [[ "$state" != "empty" ]]; then
  echo "unexpected baseline verifier state: $state" >&2
  exit 1
fi

echo "Remote migration history is empty; verifying the live 0001-0007 schema before repair."
for migration in supabase/migrations/*.sql; do
  version="$(basename "$migration")"
  version="${version%%_*}"
  if [[ "$version" > "$baseline_last" ]]; then
    mv -- "$migration" "$pending_dir/$(basename "$migration")"
  fi
done

public_diff="$workdir/public-baseline.diff.sql"
supabase db diff --linked --schema public --use-migra > "$public_diff"
if grep -Eq '[^[:space:]]' "$public_diff"; then
  echo "Production public schema differs from the reviewed 0001-0007 baseline; refusing migration-history repair." >&2
  echo "Schema diff follows:" >&2
  sed -n '1,200p' "$public_diff" >&2
  exit 1
fi

storage_schema="$workdir/storage-schema.sql"
storage_data="$workdir/storage-data.sql"
supabase db dump --linked --schema storage --file "$storage_schema"
supabase db dump \
  --linked \
  --schema storage \
  --data-only \
  --use-copy \
  --exclude storage.objects \
  --file "$storage_data"
node scripts/verify-production-migration-baseline.mjs storage "$storage_schema" "$storage_data"

# Restore the forward migrations before changing history, so the next history
# read and db push are always evaluated against the complete checked-out tree.
restore_pending_migrations

echo "Live public schema and Storage baseline match 0001-0007; recording only those reviewed versions as applied."
supabase migration repair "${baseline_versions[@]}" --status applied --linked

history_file="$workdir/history-after.txt"
capture_history "$history_file"
state="$(node scripts/verify-production-migration-baseline.mjs history "$history_file" supabase/migrations)"
if [[ "$state" != "established" ]]; then
  echo "migration history repair did not establish the expected baseline" >&2
  exit 1
fi

echo "Production migration-history baseline established; forward migrations remain pending."
