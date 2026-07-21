#!/usr/bin/env bash
# Verify an encrypted release backup, or restore it to an empty isolated Supabase project.
# This script intentionally refuses an in-place production restore.

set -Eeuo pipefail
umask 077

usage() {
  cat <<'USAGE'
Usage:
  BACKUP_ARCHIVE=... BACKUP_ENCRYPTION_KEY=... scripts/restore-db-release.sh verify

  BACKUP_ARCHIVE=... BACKUP_ENCRYPTION_KEY=... \
  RESTORE_DATABASE_URL=... RESTORE_TARGET_PROJECT_REF=... \
  RESTORE_CONFIRM_PROJECT_REF=... ALLOW_ISOLATED_RESTORE=YES \
  scripts/restore-db-release.sh restore-isolated

The restore target must be an empty, isolated project and must not have the same
project ref as the source. Cutover to production is a separate reviewed action.
USAGE
}

mode="${1:-verify}"
if [[ "$mode" != "verify" && "$mode" != "restore-isolated" ]]; then
  usage >&2
  exit 2
fi

if [[ -z "${BACKUP_ARCHIVE:-}" || -z "${BACKUP_ENCRYPTION_KEY:-}" ]]; then
  echo "BACKUP_ARCHIVE and BACKUP_ENCRYPTION_KEY are required" >&2
  exit 2
fi
if (( ${#BACKUP_ENCRYPTION_KEY} < 32 )); then
  echo "BACKUP_ENCRYPTION_KEY must contain at least 32 characters" >&2
  exit 2
fi

if [[ ! -f "$BACKUP_ARCHIVE" ]]; then
  echo "backup archive not found: $BACKUP_ARCHIVE" >&2
  exit 2
fi

for command_name in openssl tar; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "required command not found: ${command_name}" >&2
    exit 2
  fi
done

if command -v sha256sum >/dev/null 2>&1; then
  sha256_check=(sha256sum --check)
elif command -v shasum >/dev/null 2>&1; then
  sha256_check=(shasum -a 256 --check)
else
  echo "required SHA-256 command not found (sha256sum or shasum)" >&2
  exit 2
fi

workdir="$(mktemp -d "${TMPDIR:-/tmp}/nalanda-db-restore.XXXXXX")"
cleanup() {
  rm -rf "$workdir"
}
trap cleanup EXIT

decrypted_archive="$workdir/archive.tar.gz"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -pass env:BACKUP_ENCRYPTION_KEY \
  -in "$BACKUP_ARCHIVE" \
  -out "$decrypted_archive"

expected_entries="$(printf '%s\n' \
  MANIFEST \
  SHA256SUMS \
  data.sql \
  migration-history-data.sql \
  migration-history-schema.sql \
  roles.sql \
  schema.sql \
  | sort)"
actual_entries="$(tar -tzf "$decrypted_archive" | sort)"
if [[ "$actual_entries" != "$expected_entries" ]]; then
  echo "backup archive contains missing or unexpected paths; refusing extraction" >&2
  exit 1
fi
tar -xzf "$decrypted_archive" -C "$workdir"
rm -f "$decrypted_archive"

(
  cd "$workdir"
  "${sha256_check[@]}" SHA256SUMS
)

format="$(sed -n 's/^format=//p' "$workdir/MANIFEST")"
source_ref="$(sed -n 's/^source_project_ref=//p' "$workdir/MANIFEST")"
migration_history_state="$(sed -n 's/^migration_history_state=//p' "$workdir/MANIFEST")"
if [[ "$format" != "nalanda-db-release-v1" || -z "$source_ref" ]]; then
  echo "unsupported or incomplete backup manifest" >&2
  exit 1
fi
if [[ -n "$migration_history_state" && "$migration_history_state" != "present" && "$migration_history_state" != "absent" ]]; then
  echo "unsupported migration_history_state in backup manifest" >&2
  exit 1
fi

echo "Backup verification succeeded."
sed -n '/^created_at=/p; /^git_sha=/p; /^source_project_ref=/p; /^scope=/p; /^migration_history_state=/p; /^storage_object_bytes_included=/p' \
  "$workdir/MANIFEST"

if [[ "$mode" == "verify" ]]; then
  exit 0
fi

for command_name in psql; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "required command not found: ${command_name}" >&2
    exit 2
  fi
done

required=(
  RESTORE_DATABASE_URL
  RESTORE_TARGET_PROJECT_REF
  RESTORE_CONFIRM_PROJECT_REF
  ALLOW_ISOLATED_RESTORE
)
for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "missing required environment variable: ${name}" >&2
    exit 2
  fi
done

if [[ "$ALLOW_ISOLATED_RESTORE" != "YES" ]]; then
  echo "set ALLOW_ISOLATED_RESTORE=YES after reviewing the recovery plan" >&2
  exit 2
fi
if [[ "$RESTORE_TARGET_PROJECT_REF" != "$RESTORE_CONFIRM_PROJECT_REF" ]]; then
  echo "restore project ref confirmation does not match" >&2
  exit 2
fi
if [[ "$RESTORE_TARGET_PROJECT_REF" == "$source_ref" ]]; then
  echo "in-place restore is refused; restore to an isolated project first" >&2
  exit 2
fi
if [[ "$RESTORE_DATABASE_URL" != *"$RESTORE_TARGET_PROJECT_REF"* ]]; then
  echo "RESTORE_DATABASE_URL does not contain the confirmed target project ref" >&2
  exit 2
fi

existing_rows="$(
  psql "$RESTORE_DATABASE_URL" -X -A -t -v ON_ERROR_STOP=1 \
    -c "select (select count(*) from pg_tables where schemaname = 'public') || ':' || (select count(*) from auth.users) || ':' || (select count(*) from storage.objects)"
)"
if [[ "$existing_rows" != "0:0:0" ]]; then
  echo "restore target is not empty (public tables:auth users:storage objects = ${existing_rows}); refusing" >&2
  exit 2
fi

# Follow the Supabase recovery order in one transaction. Disabling user triggers is
# essential: otherwise community/schedule triggers would grant points and mutate
# counters a second time while the snapshot is loaded.
echo "Restoring roles, schema, data, and migration history to isolated project ${RESTORE_TARGET_PROJECT_REF}."
{
  cat "$workdir/roles.sql"
  cat "$workdir/schema.sql"
  printf 'set session_replication_role = replica;\n'
  cat "$workdir/data.sql"
  printf 'set session_replication_role = origin;\n'
  cat "$workdir/migration-history-schema.sql"
  cat "$workdir/migration-history-data.sql"
} | psql "$RESTORE_DATABASE_URL" -X --single-transaction -v ON_ERROR_STOP=1

echo "Isolated database restore completed. Do not cut over yet."
echo "Run RLS, integrity, Auth, Storage metadata/object, and application smoke checks first."
