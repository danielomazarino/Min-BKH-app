#!/usr/bin/env bash
#
# Gemini free-tier budget check.
#
# Answers ONE question at the cost of 0 or 1 generation requests:
#
#   Is at least one free-tier generation request still available today?
#
# Hard guarantees, which are the entire reason this script exists:
#   * The metadata call (GET /v1beta/models) costs ZERO daily quota.
#   * At most ONE generateContent call is ever made, and only if auth succeeded.
#   * There is no retry, no model fallback, and no loop.
#   * A failure is an ANSWER. It is reported, not retried.
#
# The script exits 0 for every classification, including failures. A budget
# check that goes red would look like a broken pipeline; the result belongs in
# the log, not in a red X.

set -uo pipefail

MODEL="${GEMINI_MODEL:-gemini-3.8-flash}"
BASE="https://generativelanguage.googleapis.com/v1beta"
CLASS="unknown"
SPEND=0

hr() { printf '\n=== %s ===\n' "$1"; }

hr "Gemini budget check"
printf 'model : %s\n' "$MODEL"
printf 'date  : %s\n' "$(date -u +%FT%TZ)"

# --- Step 0: the key ------------------------------------------------------
if [ -z "${GEMINI_API_KEY:-}" ]; then
  CLASS="no-key"
  printf 'key   : MISSING (secret GEMINI_API_KEY is empty or unset)\n'
  hr "RESULT: $CLASS"
  printf 'Spend: 0 generation requests.\n'
  printf 'Action: add GEMINI_API_KEY to repository secrets. Do not retry blindly.\n'
  exit 0
fi
# Length only. The key itself is never printed, not even partially.
printf 'key   : present (len=%s)\n' "${#GEMINI_API_KEY}"

# --- Step 1: free auth check (zero quota cost) ---------------------------
hr "Step 1: auth check (costs 0 quota)"
AUTH_CODE="$(curl -s -o /tmp/gemini_models.json -w '%{http_code}' \
  -H "x-goog-api-key: ${GEMINI_API_KEY}" \
  "${BASE}/models" 2>/dev/null || echo "000")"
printf 'HTTP %s from GET /v1beta/models\n' "$AUTH_CODE"

if [ "$AUTH_CODE" != "200" ]; then
  case "$AUTH_CODE" in
    401|403) CLASS="auth-blocked" ;;
    429)     CLASS="quota-exhausted" ;;
    000)     CLASS="network-blocked" ;;
    *)       CLASS="auth-check-failed" ;;
  esac
  hr "RESULT: $CLASS"
  printf 'Spend: 0 generation requests.\n'
  exit 0
fi

# Is our target model even listed for this key?
# NOTE: the API returns the fully-qualified "models/gemini-3.8-flash", so a
# bare grep for "gemini-3.8-flash" matches too loosely and a strict grep for
# the bare name reports a FALSE NEGATIVE. Match the qualified form.
if grep -q "\"models/${MODEL}\"" /tmp/gemini_models.json 2>/dev/null; then
  printf 'model %s IS listed for this key\n' "$MODEL"
else
  printf 'model %s is NOT listed for this key\n' "$MODEL"
  printf 'Available models this key can see:\n'
  grep -o '"name": *"models/[^"]*"' /tmp/gemini_models.json \
    | sed 's|.*models/||; s|"||' | sort -u | sed 's/^/  - /'
  printf 'Not listing the model is NOT the same as no budget. Continuing to the\n'
  printf 'generation probe, which is the only real test of reachability.\n'
fi

# --- Step 2: exactly one generation request -------------------------------
hr "Step 2: single generation probe (spends 1 request)"
printf 'Sending ONE generateContent call with maxOutputTokens=32.\n'
printf 'No retry, no fallback model. Whatever comes back is the result.\n'

REQ="{\"contents\":[{\"role\":\"user\",\"parts\":[{\"text\":\"Reply with the single word: ok\"}]}],\"generationConfig\":{\"temperature\":0.1,\"maxOutputTokens\":32}}"

GEN_CODE="$(curl -s -o /tmp/gemini_gen.json -w '%{http_code}' \
  -X POST \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: ${GEMINI_API_KEY}" \
  -d "$REQ" \
  "${BASE}/models/${MODEL}:generateContent" 2>/dev/null || echo "000")"
SPEND=1
printf 'HTTP %s from POST generateContent\n' "$GEN_CODE"

hr "Verbatim error body (if any)"
# Print the body on failure: Google's 429/503 messages usually NAME the exact
# reason, and that reason is the most valuable output of this whole check.
if [ "$GEN_CODE" = "200" ]; then
  printf 'HTTP 200 — body omitted for brevity.\n'
else
  head -c 1200 /tmp/gemini_gen.json
  printf '\n'
fi

# --- Step 3: classify -----------------------------------------------------
case "$GEN_CODE" in
  200) CLASS="budget-available" ;;
  401|403) CLASS="auth-blocked" ;;
  404) CLASS="model-unavailable" ;;
  429) CLASS="quota-exhausted" ;;
  500|502|503|504) CLASS="capacity-blocked" ;;
  000) CLASS="network-blocked" ;;
  *) CLASS="unexpected-status" ;;
esac

hr "RESULT: $CLASS"
printf 'Spend: %s generation request(s).\n' "$SPEND"

case "$CLASS" in
  budget-available)
    cat <<'EOF'
Interpretation:
  At least ONE generation request exists. The API does NOT expose a balance
  endpoint, so the remaining count is UNKNOWN. This is not a quota reading.

  This is NOT a green light for the news or player use cases. A 200 proves
  capacity, not semantic quality. Run 36215617435 already returned HTTP 200
  with zero usable events, so the use cases need their own verification.
EOF
    ;;
  quota-exhausted)
    cat <<'EOF'
Interpretation:
  No free-tier generation budget remains today. Budget resets at midnight
  Pacific (07:00/08:00 UTC depending on DST).

  This is a COMPLETE and ACCEPTABLE result. Gemini stays disabled; the
  deterministic fallback in pipeline/src/newsEvents.ts carries the news feed.
  The app is healthy and needs no further requests today.

  If the verbatim body above stated an actual RPD number, quote it verbatim in
  docs/ENHANCEMENTS.md and correct the assumed 20/day figure.
EOF
    ;;
  capacity-blocked)
    cat <<'EOF'
Interpretation:
  Capacity, NOT quota. These are different problems and must not be conflated.
  Intermittent 503s were seen on 2026-09-25. Do not spend more requests
  hammering it today.
EOF
    ;;
  model-unavailable)
    cat <<'EOF'
Interpretation:
  The key cannot use this model. Observed 2026-09-25: gemini-2.5-flash returns
  404 "no longer available to new users", which indicates a free-tier key with
  no billing enabled. There is NO free model to fall back to.

  Expected and acceptable: Gemini remains disabled, the deterministic fallback
  carries the news feed, and no further requests are spent on this.
EOF
    ;;
  auth-blocked)
    cat <<'EOF'
Interpretation:
  The secret exists but is invalid, revoked, or lacks permission. Spending a
  generation request would not have helped; the free auth check caught it at
  zero cost.
EOF
    ;;
esac

exit 0
