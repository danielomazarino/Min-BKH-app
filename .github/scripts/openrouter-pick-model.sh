#!/usr/bin/env bash
# Resolve which OpenRouter :free model to use. ZERO generation requests.
#
# WHY A SEPARATE SCRIPT
#   The resolution was first written as an inline `$(curl | python3 -c '...')`
#   nested inside "${INPUT_MODEL:-...}" in the workflow. Bash quoting broke
#   (run 37531646221: "unexpected EOF while looking for matching `\"'") — the
#   same class of quoting defect this repo hit twice before. A file with a
#   plain heredoc removes the nesting entirely.
#
# SELECTION (deterministic given a catalog — mirrors pipeline/src/openrouterModel.ts)
#   1. $1 (explicit pin, e.g. workflow input) wins if it ends in :free
#   2. first entry of PREFERRED_MODELS still listed in the live catalog
#   3. alphabetically first free model (stable tie-break)
#
# COST: GET /api/v1/models is a public metadata call. No key, no quota, no
# generation request. Prints exactly one line: the model id.

set -euo pipefail

PIN="${1:-}"

if [ -n "$PIN" ]; then
  case "$PIN" in
    *:free) printf '%s\n' "$PIN"; exit 0 ;;
    *)
      printf 'refusing: pin "%s" is not a :free variant\n' "$PIN" >&2
      exit 2
      ;;
  esac
fi

CATALOG="$(mktemp)"
trap 'rm -f "$CATALOG"' EXIT
curl -s https://openrouter.ai/api/v1/models -o "$CATALOG"

python3 - "$CATALOG" <<'PY'
import json, sys

PREFERRED = [
    "google/gemma-4-31b-it:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "google/gemma-4-26b-a4b-it:free",
    "inclusionai/ling-3.0-flash-sante:free",
]

ids = sorted(m["id"] for m in json.load(open(sys.argv[1]))["data"] if m["id"].endswith(":free"))
if not ids:
    sys.exit("no :free models in the OpenRouter catalog")

for p in PREFERRED:
    if p in ids:
        print(p)
        break
else:
    print(ids[0])
PY