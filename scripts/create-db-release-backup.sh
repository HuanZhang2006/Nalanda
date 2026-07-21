#!/usr/bin/env bash
# Create an encrypted logical recovery point before a production migration.
# The archive contains database SQL only; Supabase Storage object bytes need a separate backup.

set -Eeuo pipefail
umask 077

required=(
  SUPABASE_ACCESS_TOKEN
  SUPABASE_DB_PASSWORD
  SUPABASE_PROJECT_REF
  BACKUP_ENCRYPTION_KEY
  BACKUP_OUTPUT
)

for name in "${required[@]}"; do
  if [[ -z "${!name:-}" ]]; then
    echo "missing required environment variable: ${name}" >&2
    exit 2
  fi
done

if (( ${#BACKUP_ENCRYPTION_KEY} < 32 )); then
  echo "BACKUP_ENCRYPTION_KEY must contain at least 32 characters" >&2
  exit 2
fi

for command_name in supabase openssl tar; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "required command not found: ${command_name}" >&2
    exit 2
  fi
done

if command -v sha256sum >/dev/null 2>&1; then
  sha256=(sha256sum)
  sha256_check=(sha256sum --check)
elif command -v shasum >/dev/null 2>&1; then
  sha256=(shasum -a 256)
  sha256_check=(shasum -a 256 --check)
else
  echo "required SHA-256 command not found (sha256sum or shasum)" >&2
  exit 2
fi

case "$BACKUP_OUTPUT" in
  *.tar.gz.enc) ;;
  *)
    echo "BACKUP_OUTPUT must end in .tar.gz.enc" >&2
    exit 2
    ;;
esac

workdir="$(mktemp -d "${TMPDIR:-/tmp}/nalanda-db-backup.XXXXXX")"
cleanup() {
  rm -rf "$workdir"
}
trap cleanup EXIT

mkdir -p "$(dirname "$BACKUP_OUTPUT")"

echo "Linking the explicitly selected Supabase project ${SUPABASE_PROJECT_REF}."
supabase link --project-ref "$SUPABASE_PROJECT_REF" >/dev/null

echo "Dumping roles, schema, data, and migration history with the Supabase recovery format."
supabase db dump --linked --role-only --file "$workdir/roles.sql"
supabase db dump --linked --file "$workdir/schema.sql"
supabase db dump \
  --linked \
  --data-only \
  --use-copy \
  --exclude storage.buckets_vectors \
  --exclude storage.vector_indexes \
  --file "$workdir/data.sql"

# Projects created before CLI migration history was adopted may not have this
# schema at all. Preserve that absence explicitly; every other dump error is
# still fatal and blocks the release.
migration_history_state="present"
history_schema_error="$workdir/migration-history-schema.stderr"
if supabase db dump \
  --linked \
  --schema supabase_migrations \
  --file "$workdir/migration-history-schema.sql" \
  2>"$history_schema_error"; then
  cat "$history_schema_error" >&2
  supabase db dump \
    --linked \
    --schema supabase_migrations \
    --data-only \
    --use-copy \
    --file "$workdir/migration-history-data.sql"
elif grep -Fq "no matching schemas were found" "$history_schema_error"; then
  migration_history_state="absent"
  echo "Remote supabase_migrations schema is absent; recording that state in the recovery point."
  printf '%s\n' \
    '-- Nalanda recovery point: supabase_migrations schema was absent at capture time.' \
    > "$workdir/migration-history-schema.sql"
  printf '%s\n' \
    '-- Nalanda recovery point: no migration-history data existed at capture time.' \
    > "$workdir/migration-history-data.sql"
else
  cat "$history_schema_error" >&2
  exit 1
fi
rm -f "$history_schema_error"

for dump_file in \
  roles.sql \
  schema.sql \
  data.sql \
  migration-history-schema.sql \
  migration-history-data.sql; do
  if [[ ! -s "$workdir/$dump_file" ]]; then
    echo "database dump is empty: $dump_file" >&2
    exit 1
  fi
done

created_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
git_sha="${GITHUB_SHA:-$(git rev-parse HEAD)}"
supabase_version="$(supabase --version)"

{
  printf 'format=nalanda-db-release-v1\n'
  printf 'created_at=%s\n' "$created_at"
  printf 'git_sha=%s\n' "$git_sha"
  printf 'source_project_ref=%s\n' "$SUPABASE_PROJECT_REF"
  printf 'supabase_cli=%s\n' "$supabase_version"
  printf 'scope=roles-schema-auth-storage-and-application-data-migration-history\n'
  printf 'migration_history_state=%s\n' "$migration_history_state"
  printf 'storage_object_bytes_included=no\n'
} > "$workdir/MANIFEST"

(
  cd "$workdir"
  "${sha256[@]}" \
    MANIFEST \
    roles.sql \
    schema.sql \
    data.sql \
    migration-history-schema.sql \
    migration-history-data.sql > SHA256SUMS
)

tar -C "$workdir" -czf - \
  MANIFEST \
  SHA256SUMS \
  roles.sql \
  schema.sql \
  data.sql \
  migration-history-schema.sql \
  migration-history-data.sql \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
      -pass env:BACKUP_ENCRYPTION_KEY \
      -out "$BACKUP_OUTPUT"

if [[ ! -s "$BACKUP_OUTPUT" ]]; then
  echo "encrypted backup was not created" >&2
  exit 1
fi

# Fail the release before migrations unless the ciphertext decrypts and every
# extracted file still matches the manifest checksums.
mkdir "$workdir/verify"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -pass env:BACKUP_ENCRYPTION_KEY \
  -in "$BACKUP_OUTPUT" \
  | tar -xzf - -C "$workdir/verify"
(
  cd "$workdir/verify"
  "${sha256_check[@]}" SHA256SUMS >/dev/null
)

echo "Encrypted database recovery point created: $BACKUP_OUTPUT"
echo "Storage object bytes are not included; follow docs/operations/BACKUP_RECOVERY.md."
