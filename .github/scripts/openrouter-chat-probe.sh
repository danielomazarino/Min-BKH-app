#!/usr/bin/env bash
# ONE request. A general chat question with a LARGER expected answer.
#
# This is the OpenRouter twin of .github/scripts/gemini-chat-probe.sh, and it
# exists for a specific reason: on Gemini that probe scored 0/15 — never once
# succeeded — while the tiny ping scored 10/21. Two explanations fit that data
# equally well:
#
#   (a) REQUEST SHAPE.  The chat probe differs from the ping in five ways:
#       586 vs 144 input bytes, 2048 vs 1024 max output tokens, temperature
#       0.5 vs 0.1, `response_format: json_object` present, and a
#       system message present. Any of those could route to a differently
#       loaded backend.
#   (b) TIME OF DAY.  The Gemini schedule computed probe parity from the UTC
#       hour, so the chat probe only ever fired at 05/09/13/17/21 UTC and the
#       ping only at 03/07/11/15/19/23. The two probes therefore sampled
#       DISJOINT HOURS, and "chat always fails" was indistinguishable from
#       "those hours always fail". That was a design flaw, not a finding.
#
# So this script deliberately keeps the chat shape EXACTLY as it was, in order
# to ask the same question on a different provider. Same five differences from
# the ping, unchanged and un-tuned. Changing them here would destroy the only
# thing that makes the result comparable to Gemini's 0/15.
#
# WHAT A RESULT MEANS
#   200 -> large-output JSON chat works here. Gemini's 0/15 was provider- or
#          shape-specific, not a property of the task.
#   503 -> OpenRouter had no provider available either. Worth noting: on
#          OpenRouter 503 means NO PROVIDER MET ROUTING, which is a different
#          failure from Gemini's "model experiencing high demand".
#   429 -> free-model cap, or the upstream provider is rate limiting.
#
# COST: exactly ONE generation request. No retry, no model fallback, no loop.
# Writes nothing: no app.json, no repo files, no commits.

set -uo pipefail

MODEL="${OPENROUTER_MODEL:?OPENROUTER_MODEL must be set (use a :free model id)}"
BASE="${OPENROUTER_BASE_URL:-https://openrouter.ai/api/v1}"
PAYLOAD=/tmp/openrouter_chat_probe_payload.json
RESULT=/tmp/openrouter_chat_probe_result.json
MAX_TOKENS="${MAX_TOKENS:-2048}"

hr() { printf '\n=== %s ===\n' "$1"; }

if [ -z "${OPENROUTER_API_KEY:-}" ]; then
  printf 'FATAL: OPENROUTER_API_KEY is not set. Nothing to test.\n' >&2
  exit 2
fi

case "$MODEL" in
  *:free) ;;
  *)
    printf 'FATAL: refusing to run — model is not a :free variant.\n' >&2
    exit 2
    ;;
esac

# ---------------------------------------------------------------------------
# TINY INPUT (~700 chars). Mirrors the Gemini chat probe's question verbatim so
# the two providers answer the SAME task. Asks for a structured answer in
# Swedish about something the model can answer from general knowledge, so the
# output size is governed by our schema rather than by a lookup.
# ---------------------------------------------------------------------------
python3 - "$PAYLOAD" "$MODEL" "$MAX_TOKENS" <<'PY'
import json, sys
out, model, max_tokens = sys.argv[1], sys.argv[2], int(sys.argv[3])

question = (
    "Skriv en kort svensk nyhetssammanfattning om varför fotbollsmatcher "
    "spelas i två halvlekar. Svara med JSON enligt följande format: {\"items\": "
    "[{\"headline\": str, \"summary\": str, \"sources\": [str]}]}. Varje objekt "
    "ska ha en rubrik, en sammanfattning på högst 200 tecken, och en lista med "
    "källor. Leverera 5 poster."
)

payload = {
  "model": model,
  "messages": [
    {"role": "system",
     "content": "Du svarar alltid med giltig JSON och inget annat."},
    {"role": "user", "content": question},
  ],
  # response_format is one of the five shape differences vs the ping, kept
  # deliberately so this stays comparable to the Gemini 0/15 result.
  "response_format": {"type": "json_object"},
  "temperature": 0.5,
  "max_tokens": max_tokens,
}
json.dump(payload, open(out, "w"), ensure_ascii=False)
PY

printf 'model         : %s\n' "$MODEL"
printf 'max_tokens    : %s  <- the LARGE expected output\n' "$MAX_TOKENS"
printf 'request bytes : %s  <- SMALL input\n' "$(wc -c < "$PAYLOAD")"

hr "THE one request"
CODE="$(curl -s -o "$RESULT" -w '%{http_code}' -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${OPENROUTER_API_KEY}" \
  -d @"$PAYLOAD" \
  "${BASE}/chat/completions" \
  2>/dev/null || echo 000)"

printf 'HTTP %s\n' "$CODE"
printf 'CHATPROBE %s http=%s model=%s\n' "$(date -u +%FT%TZ)" "$CODE" "$MODEL"

if [ "$CODE" = "200" ]; then
  hr "RESULT: 200 — small input, large output SUCCEEDED"
  python3 - "$RESULT" <<'PY'
import json, sys
raw = json.load(open(sys.argv[1]))
text = (raw.get("choices") or [{}])[0].get("message", {}).get("content", "")
usage = raw.get("usage") or {}
print(f"output characters : {len(text)}")
print(f"output tokens     : ~{usage.get('completion_tokens','n/a')}")
print(f"finish reason     : {(raw.get('choices') or [{}])[0].get('finish_reason','n/a')}")
print(f"provider          : {raw.get('provider','n/a')}")
if usage.get("cost") is not None:
    print(f"cost              : {usage['cost']} credits")
try:
    obj = json.loads(text)
    items = obj.get("items", [])
    print(f"items parsed      : {len(items)}")
    for it in items[:5]:
        s = it.get("summary", "")
        mark = "ok " if 0 < len(s) <= 200 else "LEN"
        src = it.get("sources", [])
        print(f"  [{mark}] {len(s):3d}ch  {it.get('headline','')[:52]}")
        print(f"          sources: {len(src)} -> {str(src[:2])[:60]}")
except Exception as e:
    print(f"JSON parse failed: {e}")
    print("raw:", text[:400])
PY
  hr "INTERPRETATION"
  printf '  Small input + large expected JSON output WORKS on OpenRouter.\n'
  printf '  Gemini 0/15 was therefore provider-specific, not a property of the\n'
  printf '  task. OpenRouter is a viable candidate for the news grouping path.\n'
else
  hr "RESULT: $CODE — no usable answer produced"
  printf 'This is a transport answer, not a verdict on grouping quality.\n'
fi

exit 0
