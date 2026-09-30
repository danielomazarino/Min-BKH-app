#!/usr/bin/env bash
# ONE request. Records whether the Gemini API is reachable RIGHT NOW.
#
# This is a measurement, not an experiment. The variable under test is TIME.
# Everything about the request is held constant at the production setting so
# that any variation in outcome is attributable to the server, not to us.
#
# HELD CONSTANT (deliberately)
#   - model:      gemini-3.8-flash, the production model
#   - thinking:   NOT SET. Gemini 3.x defaults to medium. We do not override it,
#                 because a request's shape does not affect whether an
#                 overloaded server accepts it — and changing it here would
#                 confound a baseline measurement.
#   - payload:    identical every time, so two samples are comparable
#   - cost:       exactly one generateContent call, never retried
#
# WHY maxOutputTokens IS 1024 HERE
#   Not to test output size — Google documents 503 as server load, with no
#   size-dependent component. 1024 is chosen so this sample resembles the real
#   news-eval request (which uses ~1024) rather than the trivial 32-token
#   budget ping. Measuring the thing we actually intend to run is the point.
#
# The free metadata call is NOT made here. It costs no quota, but it also
# proves nothing about generateContent availability, and skipping it keeps this
# script to exactly one request.

set -uo pipefail

MODEL="${GEMINI_MODEL:-gemini-3.8-flash}"
RESULT=/tmp/gemini_availability.json

printf '=== Gemini availability sample ===\n'
printf 'timestamp_utc : %s\n' "$(date -u +%FT%TZ)"
printf 'model         : %s\n' "$MODEL"
printf 'thinking      : default (medium on Gemini 3.x) — deliberately not set\n'
printf 'maxOutputTokens: 1024 (matches the real news-eval request)\n'

if [ -z "${GEMINI_API_KEY:-}" ]; then
  printf 'FATAL: GEMINI_API_KEY is not set. Nothing sampled.\n' >&2
  exit 2
fi

REQ='{"contents":[{"role":"user","parts":[{"text":"Reply with the single word: ok"}]}],"generationConfig":{"temperature":0.1,"maxOutputTokens":1024}}'

printf 'request bytes : %s\n' "$(printf '%s' "$REQ" | wc -c)"
printf 'COST          : 1 generation request, never retried\n'

CODE="$(curl -s -o "$RESULT" -w '%{http_code}' -X POST \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: ${GEMINI_API_KEY}" \
  -d "$REQ" \
  "https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent" \
  2>/dev/null || echo 000)"

printf 'HTTP %s\n' "$CODE"

# A single line a human (or a later run) can grep across the night.
printf 'SAMPLE %s http=%s\n' "$(date -u +%FT%TZ)" "$CODE"

case "$CODE" in
  200)
    printf '\n=== REACHABLE ===\n'
    python3 - "$RESULT" <<'PY' 2>/dev/null || printf '(body not parsed)\n'
import json, sys
d = json.load(open(sys.argv[1]))
c = (d.get("candidates") or [{}])[0]
text = (c.get("content") or {}).get("parts", [{}])[0].get("text", "").strip()
u = d.get("usageMetadata") or {}
print(f"reply        : {text[:60]!r}")
print(f"finishReason : {c.get('finishReason','n/a')}")
print(f"output tokens: {u.get('candidatesTokenCount','n/a')}")
print(f"thought tokens: {u.get('thoughtsTokenCount','n/a')}")
print(f"total tokens : {u.get('totalTokenCount','n/a')}")
PY
    ;;
  429)
    printf '\n=== QUOTA, NOT CAPACITY ===\n'
    printf 'A 429 is rate_limit_exceeded or quota_exceeded — a DIFFERENT cause\n'
    printf 'from 503. Do not record it as an availability sample.\n'
    head -c 300 "$RESULT"; printf '\n'
    ;;
  503)
    printf '\n=== OVERLOADED (documented: "service is temporarily overloaded") ===\n'
    printf 'Not a verdict on our request. Retry later per Google guidance.\n'
    head -c 300 "$RESULT"; printf '\n'
    ;;
  *)
    printf '\n=== UNEXPECTED %s ===\n' "$CODE"
    head -c 400 "$RESULT"; printf '\n'
    ;;
esac

printf '\nSpend: 1 generation request.\n'
