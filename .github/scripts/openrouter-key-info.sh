#!/usr/bin/env bash
# ZERO generation requests. Reads the OpenRouter key's own accounting.
#
# WHY THIS EXISTS
#   Gemini's free tier has NO balance endpoint. This repo spent weeks unable to
#   distinguish "quota exhausted" from "service unhealthy" because the only
#   evidence was whichever HTTP code came back. OpenRouter publishes the counter
#   directly, so this script closes that blind spot — and it costs nothing,
#   because GET /api/v1/key is a metadata call, not an inference call.
#
#   Documented shape (docs/api-reference/limits), the fields that matter here:
#     free_model_daily_requests : { used, limit, remaining }
#     is_free_tier              : whether the account has ever bought credits
#     usage_daily               : credits spent in the current UTC day
#     limit / limit_remaining   : per-key credit cap, if one is configured
#
#   Free-model ceilings (documented):
#     < 10 credits purchased all-time : 20 req/min,  50 req/day
#     >= 10 credits purchased         : 20 req/min, 1000 req/day
#
# COST: 0 generation requests. No inference is attempted. Nothing is written.
#   An absent key is a normal, expected state, not an error — it exits 0.

set -uo pipefail

BASE="${OPENROUTER_BASE_URL:-https://openrouter.ai/api/v1}"
RESULT=/tmp/openrouter_key_info.json

printf '=== OpenRouter key info (0 generation requests) ===\n'
printf 'timestamp_utc : %s\n' "$(date -u +%FT%TZ)"

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  printf 'no-key        : OPENROUTER_API_KEY is not set.\n'
  printf '               Add it with: gh secret set OPENROUTER_API_KEY\n'
  exit 0
fi

CODE="$(curl -s -o "$RESULT" -w '%{http_code}' \
  -H "Authorization: Bearer ${OPENROUTER_API_KEY}" \
  "${BASE}/key" 2>/dev/null || echo 000)"

printf 'HTTP %s\n' "$CODE"

case "$CODE" in
  200)
    printf '\n=== KEY OK ===\n'
    python3 - "$RESULT" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
data = d.get("data") or d

label = data.get("label", "n/a")
print(f"label              : {label}")
print(f"is_free_tier       : {data.get('is_free_tier','n/a')}  (never bought credits)")

fr = data.get("free_model_daily_requests") or {}
if fr:
    used  = fr.get("used")
    limit = fr.get("limit")
    rem   = fr.get("remaining")
    print(f"free requests today: used={used} limit={limit} remaining={rem}")
    if isinstance(used, int) and isinstance(limit, int) and limit:
        pct = 100.0 * used / limit
        print(f"                    ({pct:.0f}% of today's free allowance spent)")
        if isinstance(rem, int) and rem <= 5:
            print("                    LOW — further free requests may 429 or 402")
else:
    print("free requests today: not reported (account may be exempt)")

print(f"credits used today : {data.get('usage_daily','n/a')}")
lim, rem = data.get("limit"), data.get("limit_remaining")
if lim is not None:
    print(f"per-key cap        : limit={lim} remaining={rem} reset={data.get('limit_reset','n/a')}")
else:
    print("per-key cap        : none (unlimited)")

if data.get("usage") is not None:
    print(f"credits used total : {data.get('usage')}")
PY
    ;;
  401)
    printf '\n=== AUTH BLOCKED ===\n'
    printf 'The key was rejected. Check it is current and not disabled.\n'
    ;;
  402)
    printf '\n=== NO CREDITS ===\n'
    printf 'Balance or per-key credit limit is exhausted. A NEGATIVE balance can\n'
    printf '402 even on :free models; a zero balance may be fine. New accounts\n'
    printf 'also get a small free allowance - check the Activity page.\n'
    ;;
  *)
    printf '\n=== UNEXPECTED STATUS %s ===\n' "$CODE"
    head -c 400 "$RESULT" 2>/dev/null; printf '\n'
    ;;
esac

exit 0
