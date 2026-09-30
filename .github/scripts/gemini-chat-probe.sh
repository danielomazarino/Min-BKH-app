#!/usr/bin/env bash
# ONE request. A general chat question with a LARGER expected answer.
#
# WHAT THIS TESTS, PRECISELY
#   Today, with the same key and model inside one hour:
#     - a ~0.3 KB request  -> HTTP 200 twice
#     - a  ~23  KB request -> HTTP 503 twelve times
#   That is a correlation between PAYLOAD SIZE and failure. It is not a cause,
#   and it is confounded: the 23 KB request also fetched six article bodies and
#   asked a different question.
#
#   This probe breaks the confound on the OUTPUT side. The input is TINY (well
#   under 1 KB). The expected OUTPUT is large — a structured multi-item answer.
#   So:
#     - 200 here  -> a small request with a big expected answer works. The 23 KB
#                    failure was about input size, not about output.
#     - 503 here  -> large OUTPUT is itself rejected. The problem is not the
#                    input at all, and shrinking the eval payload would not help.
#
#   Either answer is decisive, which is the point. A 503 is a valid result.
#
# COST: exactly ONE generation request. No retry, no model fallback, no loop.
# Writes nothing: no app.json, no repo files, no commits.

set -uo pipefail

MODEL="${GEMINI_MODEL:-gemini-3.8-flash}"
PAYLOAD=/tmp/gemini_chat_probe_payload.json
RESULT=/tmp/gemini_chat_probe_result.json
MAX_TOKENS="${MAX_TOKENS:-2048}"

hr() { printf '\n=== %s ===\n' "$1"; }

if [ -z "${GEMINI_API_KEY:-}" ]; then
  printf 'FATAL: GEMINI_API_KEY is not set. Nothing to test.\n' >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# TINY INPUT (~700 chars). Asks for a structured answer in Swedish about
# something the model can answer from general knowledge, so the output size is
# governed by our schema rather than by anything the model must look up.
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
  "system_instruction": {"parts": [{"text":
    "Du svarar alltid med giltig JSON och inget annat."}]},
  "contents": [{"role": "user", "parts": [{"text": question}]}],
  "generationConfig": {
    "temperature": 0.5,
    "maxOutputTokens": max_tokens,
    "responseMimeType": "application/json",
  },
}
json.dump(payload, open(out, "w"), ensure_ascii=False)
PY

printf 'model         : %s\n' "$MODEL"
printf 'maxOutputTokens: %s  <- the LARGE expected output\n' "$MAX_TOKENS"
printf 'request bytes : %s  <- SMALL input\n' "$(wc -c < "$PAYLOAD")"

hr "THE one request"
CODE="$(curl -s -o "$RESULT" -w '%{http_code}' -X POST \
  -H "Content-Type: application/json" \
  -H "x-goog-api-key: ${GEMINI_API_KEY}" \
  -d @"$PAYLOAD" \
  "https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent" \
  2>/dev/null || echo 000)"

printf 'HTTP %s\n' "$CODE"

if [ "$CODE" = "200" ]; then
  hr "RESULT: 200 — small input, large output SUCCEEDED"
  python3 - "$RESULT" <<'PY'
import json, sys
raw = json.load(open(sys.argv[1]))
parts = raw.get("candidates") or [{}]
text = (parts[0].get("content") or {}).get("parts", [{}])[0].get("text", "")
usage = raw.get("usageMetadata") or {}
print(f"output characters : {len(text)}")
print(f"output tokens     : ~{usage.get('candidatesTokenCount', 'n/a')}")
print(f"finish reason     : {parts[0].get('finishReason', 'n/a')}")
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
  printf '\nINTERPRETATION\n'
  printf '  Small input + large expected output works. The 23KB eval failure is\n'
  printf '  therefore about INPUT size, not output. Shrinking the eval payload\n'
  printf '  is a viable direction.\n'
elif [ "$CODE" = "503" ]; then
  hr "RESULT: 503 — small input REJECTED"
  head -c 400 "$RESULT"; printf '\n\n'
  printf 'INTERPRETATION\n'
  printf '  This is the decisive negative. The input here is tiny, yet large\n'
  printf '  expected output was refused. So payload size may NOT be the driver,\n'
  printf '  and shrinking the eval payload would not necessarily help.\n'
else
  hr "RESULT: $CODE"
  head -c 500 "$RESULT"; printf '\n'
  printf 'INTERPRETATION\n'
  printf '  Unexpected code. 429 would mean QUOTA, not size — stop and report.\n'
  printf '  400 would mean the payload shape itself was rejected.\n'
fi

printf '\nSpend: 1 generation request. Never retried.\n'
