#!/usr/bin/env bash
# ONE request. Records whether the OpenRouter API is reachable RIGHT NOW.
#
# Mirrors .github/scripts/gemini-availability-sample.sh exactly, so the two
# providers can be compared without re-reading two different methodologies.
#
# HELD CONSTANT (deliberately)
#   - model:      the :free variant named by OPENROUTER_MODEL, so a measurement
#                 can never silently start costing money. A paid model id would
#                 bill real credits; the workflow sets the env var explicitly.
#   - payload:    identical every time, so two samples are comparable
#   - cost:       exactly one chat completion call, never retried
#
# WHY THE FREE KEY QUOTA IS SAFE HERE
#   OpenRouter's documented free-model limits (docs/api-reference/limits):
#     < 10 credits purchased all-time : 20 requests/min, 50 requests/day
#     >= 10 credits purchased         : 20 requests/min, 1000 requests/day
#   So the no-credits ceiling is 50/day, comfortably above the 11/day this
#   experiment would spend. `GET /api/v1/key` reports the live counter as
#   `free_model_daily_requests` — openrouter-key-info.sh reads it for free.
#
# The metadata call (GET /api/v1/models) is NOT made here. It costs nothing,
# but it proves nothing about chat completion availability, and skipping it
# keeps this script to exactly one request.

set -uo pipefail

MODEL="${OPENROUTER_MODEL:?OPENROUTER_MODEL must be set (use a :free model id)}"
BASE="${OPENROUTER_BASE_URL:-https://openrouter.ai/api/v1}"
RESULT=/tmp/openrouter_availability.json

printf '=== OpenRouter availability sample ===\n'
printf 'timestamp_utc : %s\n' "$(date -u +%FT%TZ)"
printf 'model         : %s\n' "$MODEL"
printf 'max_tokens    : 1024 (matches the real news-eval request)\n'

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  printf 'FATAL: OPENROUTER_API_KEY is not set. Nothing sampled.\n' >&2
  exit 2
fi

case "$MODEL" in
  *:free) ;;
  *)
    printf 'FATAL: refusing to run — model is not a :free variant.\n' >&2
    printf '      A paid id would spend real credits against a bounded budget.\n' >&2
    exit 2
    ;;
esac

REQ='{"model":"'"$MODEL"'","messages":[{"role":"user","content":"Reply with the single word: ok"}],"max_tokens":1024,"temperature":0.1}'

printf 'request bytes : %s\n' "$(printf '%s' "$REQ" | wc -c)"
printf 'COST          : 1 generation request, never retried\n'

CODE="$(curl -s -o "$RESULT" -w '%{http_code}' -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENROUTER_API_KEY}" \
  -d "$REQ" \
  "${BASE}/chat/completions" \
  2>/dev/null || echo 000)"

printf 'HTTP %s\n' "$CODE"
printf 'SAMPLE %s http=%s model=%s\n' "$(date -u +%FT%TZ)" "$CODE" "$MODEL"

case "$CODE" in
  200)
    printf '\n=== REACHABLE ===\n'
    python3 - "$RESULT" <<'PY' 2>/dev/null || printf '(body not parsed)\n'
import json, sys
d = json.load(open(sys.argv[1]))
text = (d.get("choices") or [{}])[0].get("message", {}).get("content", "").strip()
u = d.get("usage") or {}
print(f"reply        : {text[:60]!r}")
print(f"finish reason: {(d.get('choices') or [{}])[0].get('finish_reason','n/a')}")
print(f"output tokens: {u.get('completion_tokens','n/a')}")
print(f"total tokens : {u.get('total_tokens','n/a')}")
if d.get("usage") and "cost" not in u and d.get("id"):
    pass
if d.get("usage", {}).get("cost") is not None:
    print(f"cost         : {d['usage']['cost']} credits")
PY
    ;;
  402)
    printf '\n=== NO CREDITS ===\n'
    printf 'Account balance or key credit limit is exhausted. Per the docs a\n'
    printf 'NEGATIVE balance can produce 402 even on :free models; a zero balance\n'
    printf 'may be fine. Do not assume this is a quota problem - read the body.\n'
    ;;
  429)
    printf '\n=== RATE LIMITED ===\n'
    printf 'Free-model cap hit (20/min, 50/day without credits) or provider load.\n'
    ;;
  503)
    printf '\n=== NO PROVIDER AVAILABLE ===\n'
    printf 'No provider met the routing requirements. Free models commonly have\n'
    printf 'very few providers — this is a routing/availability answer, not quota.\n'
    ;;
esac

# Never fail the workflow on a non-200: a red X on a measurement job reads as a
# broken pipeline. The classification lives in the log, not in the exit code.
exit 0
