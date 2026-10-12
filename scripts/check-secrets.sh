#!/usr/bin/env bash
# 06 "Security checks": no secret in the repo, none in the client bundle. CI runs it after `npm run build`.
# The local postgres:postgres@localhost defaults (CI, README, test config) are not secrets and are allowed.
set -euo pipefail
cd "$(dirname "$0")/.."
fail=0

# git grep / grep exit 1 = no match (good), 0 = match (bad), anything else = the check itself failed (bad, never a silent pass).
rc=0; git grep -nP 'sk-ant-[A-Za-z0-9_-]{8,}|re_[A-Za-z0-9_]{20,}|postgres(ql)?://[^\s:/]+:[^\s@]+@(?!localhost[:/])' -- ':!docs/**' ':!scripts/check-secrets.sh' || rc=$?
case $rc in 0) echo "secret-looking value committed (above)"; fail=1 ;; 1) ;; *) echo "git grep failed ($rc)"; fail=1 ;; esac
git ls-files --error-unmatch .env >/dev/null 2>&1 && { echo ".env is tracked"; fail=1; }
rc=0; grep -nE '^[A-Z_]+=.+' .env.example || rc=$?
case $rc in 0) echo ".env.example must list names only"; fail=1 ;; 1) ;; *) echo "cannot read .env.example"; fail=1 ;; esac

if [ -d .next/static ]; then
  # Every server secret's value, and each key of the DATA_KEYS ring. Values under 8 characters are skipped (they would match anywhere); CI's placeholders are longer.
  values=()
  for name in PAYPAL_CLIENT_SECRET ANTHROPIC_API_KEY SESSION_SECRET FILE_URL_SECRET CRON_SECRET RESEND_API_KEY DATABASE_URL; do
    values+=("$name=${!name:-}")
  done
  IFS=',' read -ra ring <<< "${DATA_KEYS:-}"
  for k in ${ring[@]+"${ring[@]}"}; do values+=("DATA_KEYS=${k#*:}"); done
  for pair in "${values[@]}"; do
    name=${pair%%=*}; value=${pair#*=}
    [ ${#value} -ge 8 ] || continue
    rc=0; grep -rlF -- "$value" .next/static >/dev/null || rc=$?
    case $rc in 0) echo "$name is in the client bundle"; fail=1 ;; 1) ;; *) echo "bundle grep failed ($rc)"; fail=1 ;; esac
  done
else
  echo "no .next/static: run npm run build first for the bundle check"; fail=1
fi

[ $fail -eq 0 ] && echo "secrets check passed"
exit $fail
