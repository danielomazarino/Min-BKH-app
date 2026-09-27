#!/usr/bin/env bash
#
# Gemini size probe — is HTTP 503 caused by REQUEST SIZE or by random capacity?
#
# WHY THIS EXISTS
#   Run 36319711479 (2026-09-27): a tiny probe (maxOutputTokens=32, one
#   sentence) returned HTTP 200 on gemini-3.8-flash.
#   Run 36319955524 (2026-09-27), ~5 minutes later: the 8-article regression
#   batch (~19K chars of article text) returned HTTP 503 "high demand" THREE
#   times in a row.
#
#   Same model, same key, minutes apart. Different payload size.
#   That is a correlation, not a proof. This probe tests it properly.
#
# WHAT IT DOES
#   Sends a ladder of increasing payload sizes, one request per rung, and
#   reports where the API stops answering. The threshold is the answer.
#
# COST
#   4 requests, by default. Each rung is ONE request, never retried.
#   Override with SIZE_LADDER to change the rungs.
#
#   Usage:  bash .github/scripts/gemini-size-probe.sh
#           SIZE_LADDER="200 2000 8000 19000" bash .../gemini-size-probe.sh
#
# Requires GEMINI_API_KEY in the environment, and jq is not required.

set -uo pipefail

MODEL="${GEMINI_MODEL:-gemini-3.8-flash}"
BASE="https://generativelanguage.googleapis.com/v1beta"
# Payload sizes in characters. ~4 chars/token, so these are roughly
# 50 / 500 / 2000 / 4750 input tokens respectively.
SIZE_LADDER="${SIZE_LADDER:-200 2000 8000 19000}"

hr() { printf '\n\033[1m=== %s ===\033[0m\n' "$1"; }
ok()  { printf '\033[32m%s\033[0m\n' "$*"; }
bad() { printf '\033[31m%s\033[0m\n' "$*"; }

if [ -z "${GEMINI_API_KEY:-}" ]; then
  bad "GEMINI_API_KEY is not set. Nothing to test."
  exit 2
fi

# A real Häcken-shaped filler sentence, repeated to reach the target size.
UNIT='BK Häcken herrlag tränade inför Allsvenskanmatchen mot Kalmar FF. Gustav Lindgren scorerade två mål i andra halvleken och Jimmy Durmaz skapade flera chanser. Tränarenrotationen fortsätter med ungdomar från klubbens akademi. '

make_payload() {
  local chars="$1"
  local text="$UNIT"
  # Grow by repetition until we reach the requested size.
  while [ "${#text}" -lt "$chars" ]; do
    text="${text}${UNIT}"
  done
  text="${text:0:$chars}"
  python3 - "$text" "$MODEL" <<'PY'
import json, sys
body, model = sys.argv[1], sys.argv[2]
prompt = (
    "Analysera följande text och svara med ett JSON-objekt som innehåller "
    "nyckeln \"scope\" med värdet \"men\" eller \"unknown\".\n\n" + body
)
print(json.dumps({
    "contents": [{"role": "user", "parts": [{"text": prompt}]}],
    "generationConfig": {
        "temperature": 0.1,
        "maxOutputTokens": 64,
        "responseMimeType": "application/json",
    },
}))
PY
}

hr "Gemini size probe"
printf 'model : %s\n' "$MODEL"
printf 'date  : %s\n' "$(date -u +%FT%TZ)"
printf 'rungs : %s characters\n' "$SIZE_LADDER"
printf 'COST  : %s requests, one per rung, never retried\n' \
  "$(echo $SIZE_LADDER | wc -w)"
printf 'Key length: %s (value never printed)\n' "${#GEMINI_API_KEY}"

LAST_OK=0
FAILED_AT=""

for size in $SIZE_LADDER; do
  hr "Rung: ${size} chars (~$((size / 4)) input tokens)"
  payload="$(make_payload "$size")"
  payload_bytes=$(printf '%s' "$payload" | wc -c)

  code="$(curl -s -o /tmp/gemini_size.json -w '%{http_code}' \
    -X POST \
    -H "Content-Type: application/json" \
    -H "x-goog-api-key: ${GEMINI_API_KEY}" \
    -d "$payload" \
    "${BASE}/models/${MODEL}:generateContent" 2>/dev/null || echo "000")"

  printf 'request bytes: %s\n' "$payload_bytes"
  printf 'HTTP %s\n' "$code"

  case "$code" in
    200)
      ok "OK at ${size} chars"
      LAST_OK=$size
      ;;
    429)
      bad "429 at ${size} chars — QUOTA, not size. Stopping."
      FAILED_AT="$size (quota)"
      break
      ;;
    503)
      bad "503 at ${size} chars — capacity."
      FAILED_AT="$size (capacity)"
      break
      ;;
    400)
      bad "400 at ${size} chars — payload rejected. First 200 bytes:"
      head -c 200 /tmp/gemini_size.json; printf '\n'
      FAILED_AT="$size (bad request)"
      break
      ;;
    *)
      bad "unexpected HTTP $code at ${size} chars. First 200 bytes:"
      head -c 200 /tmp/gemini_size.json; printf '\n'
      FAILED_AT="$size (HTTP $code)"
      break
      ;;
  esac
  # Small pause so we do not trip a per-minute rate limit.
  sleep 3
done

hr "RESULT"
printf 'total requests spent: %s\n' "$(echo $SIZE_LADDER | wc -w)"
printf 'largest size that worked: %s chars\n' "${LAST_OK:-none}"

if [ -z "$FAILED_AT" ]; then
  ok "All rungs succeeded. Payload size does NOT appear to trigger 503."
  info=""
  info "Interpretation: the earlier 503 was probably transient capacity,"
  info "or depends on something other than size (e.g. content shape)."
elif [ "$LAST_OK" -gt 0 ] 2>/dev/null; then
  bad "Threshold found: works at ${LAST_OK} chars, fails at ${FAILED_AT}."
  info=""
  info "Interpretation: payload size DOES matter. The regression batch"
  info "(~19000 chars) sits above the threshold."
  info "Next step: chunk the batch, or cap per-article text length."
else
  bad "Failed from the smallest rung (${FAILED_AT}). Size is NOT the variable;"
  info "the API is refusing this model right now. Retry later."
fi

exit 0
