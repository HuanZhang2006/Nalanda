#!/usr/bin/env bash
set -Eeuo pipefail

root="${1:-/opt/nalanda}"
api_env="$root/.env"
ai_env="$root/.ai.env"
umask 077
IFS= read -r openrouter_key
IFS= read -r internal_token

if [[ ! "$openrouter_key" =~ ^sk-or-v1-[A-Za-z0-9_-]{32,}$ ]]; then
  echo "OPENROUTER_API_KEY did not match the expected secret shape" >&2
  exit 2
fi
if [[ ! "$internal_token" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "AI_INTERNAL_TOKEN must be a 32-byte hex secret" >&2
  exit 2
fi
[[ -f "$api_env" ]] || { echo "Production environment file is missing" >&2; exit 2; }

supabase_url="$(awk -F= '$1 == "SUPABASE_URL" { sub(/^[^=]*=/, ""); print; exit }' "$api_env")"
if [[ ! "$supabase_url" =~ ^https://[a-z0-9-]+\.supabase\.co$ ]]; then
  echo "Production SUPABASE_URL is missing or invalid" >&2
  exit 2
fi

api_temporary="$(mktemp "$root/.env.material-ai.XXXXXX")"
ai_temporary="$(mktemp "$root/.ai.env.material-ai.XXXXXX")"
cleanup() { rm -f "$api_temporary" "$ai_temporary"; }
trap cleanup EXIT

awk '
  !/^(FEATURE_MATERIAL_AI|AI_SERVICE_URL|AI_CALLBACK_BASE_URL|AI_INTERNAL_TOKEN|MATERIAL_AI_MONTHLY_BUDGET_USD|MATERIAL_AI_GENERATION_MAX_COST_USD|MATERIAL_AI_GRADING_MAX_COST_USD)=/
' "$api_env" > "$api_temporary"
{
  # The candidate always starts closed. Protected activation turns this on
  # only after worker readiness, resource canary, and real-provider smoke.
  printf 'FEATURE_MATERIAL_AI=false\n'
  printf 'AI_SERVICE_URL=http://ai:8000\n'
  printf 'AI_CALLBACK_BASE_URL=http://api:3000/api\n'
  printf 'AI_INTERNAL_TOKEN=%s\n' "$internal_token"
  printf 'MATERIAL_AI_MONTHLY_BUDGET_USD=20\n'
  printf 'MATERIAL_AI_GENERATION_MAX_COST_USD=0.50\n'
  printf 'MATERIAL_AI_GRADING_MAX_COST_USD=0.05\n'
} >> "$api_temporary"

{
  printf 'NODE_ENV=production\n'
  printf 'AI_INTERNAL_TOKEN=%s\n' "$internal_token"
  printf 'OPENROUTER_API_KEY=%s\n' "$openrouter_key"
  printf 'OPENROUTER_BASE_URL=https://openrouter.ai/api/v1\n'
  printf 'SUPABASE_URL=%s\n' "$supabase_url"
  printf 'PUBLIC_APP_URL=https://nalanda.online\n'
  printf 'MATERIAL_AI_FAKE_PROVIDER=false\n'
  printf 'MATERIAL_AI_TEMP_ROOT=/tmp/nalanda-material-ai\n'
  printf 'MATERIAL_AI_TEMP_MIN_FREE_BYTES=536870912\n'
  printf 'MATERIAL_AI_JOB_TEMP_LIMIT_BYTES=1073741824\n'
  printf 'MATERIAL_AI_MAX_CHARACTERS=400000\n'
  printf 'MATERIAL_AI_LIBREOFFICE_TIMEOUT_SECONDS=120\n'
  printf 'MATERIAL_AI_PROVIDER_TIMEOUT_SECONDS=180\n'
  printf 'MATERIAL_AI_PROVIDER_MAX_ATTEMPTS=4\n'
  printf 'MATERIAL_AI_PROVIDER_RETRY_BASE_SECONDS=2\n'
  printf 'MATERIAL_AI_PROVIDER_RETRY_MAX_SECONDS=60\n'
  printf 'MATERIAL_AI_GENERATION_MAX_TOKENS=30000\n'
} > "$ai_temporary"

chmod 600 "$api_temporary" "$ai_temporary"
mv "$api_temporary" "$api_env"
mv "$ai_temporary" "$ai_env"
trap - EXIT
echo "Materials AI production configuration installed without printing credentials."
