#!/usr/bin/env bash
# 06 "Security checks": no secret in the repo, none in the client bundle. CI runs it after `npm run build`.
# The local postgres:postgres@localhost defaults (CI, README, test config) are not secrets and are allowed.
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0

if git grep -nP 'sk-ant-[A-Za-z0-9_-]{8,}|re_[A-Za-z0-9]{20,}|postgres(ql)?://[^\s:/]+:[^\s@]+@(?!localhost[:/])' -- ':!docs/**' ':!scripts/check-secrets.sh'; then
  echo "secret-looking value committed (above)"; fail=1
fi
git ls-files --error-unmatch .env >/dev/null 2>&1 && { echo ".env is tracked"; fail=1; }
if grep -nE '^[A-Z_]+=.+' .env.example; then echo ".env.example must list names only"; fail=1; fi

if [ -d .next/static ]; then
  # Every server secret's value, and each key of the DATA_KEYS ring. Values under 8 characters (CI placeholders) are skipped.
  values=()
  for name in PAYPAL_CLIENT_SECRET ANTHROPIC_API_KEY SESSION_SECRET FILE_URL_SECRET CRON_SECRET RESEND_API_KEY DATABASE_URL; do
    values+=("$name=${!name:-}")
  done
  IFS=',' read -ra ring <<< "${DATA_KEYS:-}"
  for k in ${ring[@]+"${ring[@]}"}; do values+=("DATA_KEYS=${k#*:}"); done
  for pair in "${values[@]}"; do
    name=${pair%%=*}; value=${pair#*=}
    [ ${#value} -ge 8 ] || continue
    if grep -rlF -- "$value" .next/static >/dev/null; then echo "$name is in the client bundle"; fail=1; fi
  done
else
  echo "no .next/static: run npm run build first for the bundle check"; fail=1
fi

[ $fail -eq 0 ] && echo "secrets check passed"
exit $fail
