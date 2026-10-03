#!/usr/bin/env bash
set -Eeuo pipefail

root="${1:-/opt/nalanda}"
env_file="$root/.env"
umask 077
IFS= read -r openrouter_key

if [[ ! "$openrouter_key" =~ ^sk-or-v1-[A-Za-z0-9_-]{32,}$ ]]; then
  echo "OPENROUTER_API_KEY did not match the expected secret shape" >&2
  exit 2
fi
[[ -f "$env_file" ]] || { echo "Production environment file is missing" >&2; exit 2; }

temporary="$(mktemp "$root/.env.openrouter.XXXXXX")"
cleanup() { rm -f "$temporary"; }
trap cleanup EXIT

awk '
  !/^(FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED|OPENROUTER_API_KEY|OPENROUTER_MODEL|OPENROUTER_BASE_URL|OPENROUTER_TIMEOUT_MS|OPENROUTER_ASSESSMENTS_PER_MINUTE|OPENROUTER_ASSESSMENTS_PER_DAY|OPENROUTER_STT_MODEL|OPENROUTER_STT_LANGUAGE|OPENROUTER_STT_TIMEOUT_MS|OPENROUTER_STT_REQUESTS_PER_MINUTE|OPENROUTER_STT_REQUESTS_PER_DAY|OPENROUTER_STT_MONTHLY_BUDGET_MICRO_USD|OPENROUTER_STT_MICRO_USD_PER_SECOND|OPENROUTER_FAKE)=/
' "$env_file" > "$temporary"
{
  printf 'FEATURE_SPELLING_TRANSLATION_ASSESSMENT_ENABLED=true\n'
  printf 'OPENROUTER_API_KEY=%s\n' "$openrouter_key"
  printf 'OPENROUTER_MODEL=nvidia/nemotron-3-super-120b-a12b:free\n'
  printf 'OPENROUTER_BASE_URL=https://openrouter.ai/api/v1\n'
  printf 'OPENROUTER_TIMEOUT_MS=12000\n'
  printf 'OPENROUTER_ASSESSMENTS_PER_MINUTE=20\n'
  printf 'OPENROUTER_ASSESSMENTS_PER_DAY=500\n'
  printf 'OPENROUTER_STT_MODEL=fish-audio/transcribe-1\n'
  printf 'OPENROUTER_STT_LANGUAGE=zh\n'
  printf 'OPENROUTER_STT_TIMEOUT_MS=15000\n'
  printf 'OPENROUTER_STT_REQUESTS_PER_MINUTE=20\n'
  printf 'OPENROUTER_STT_REQUESTS_PER_DAY=300\n'
  printf 'OPENROUTER_STT_MONTHLY_BUDGET_MICRO_USD=5000000\n'
  printf 'OPENROUTER_STT_MICRO_USD_PER_SECOND=100\n'
  printf 'OPENROUTER_FAKE=false\n'
} >> "$temporary"
chmod 600 "$temporary"
mv "$temporary" "$env_file"
trap - EXIT

echo "OpenRouter production configuration installed without printing the credential."
