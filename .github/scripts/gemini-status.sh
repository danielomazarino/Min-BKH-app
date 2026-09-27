#!/usr/bin/env bash
#
# Gemini status — one command, no browser, no login.
#
# Answers the question you actually care about, in ascending cost:
#
#   1. Is the key valid?                       (0 requests)
#   2. Is a generation request succeeding?     (1 request, 32 tokens)
#   3. Is the news synthesis usable?           (1 request, full batch)
#
# Stages 1 and 2 are cheap and run by default. Stage 3 is opt-in with
# --full because it sends a real article batch and costs a real request.
#
# Authentication: uses `gh workflow run` / `gh run view`, which read the
# existing `gh` login (keyring). No browser, no token paste, no login dance.
#
# Usage:
#   gemini-status.sh              # stage 1 + 2  -> costs at most 1 request
#   gemini-status.sh --full       # also stage 3 -> costs at most 2 more
#   gemini-status.sh --history    # recent runs, no requests at all

set -uo pipefail

MODE="${1:-}"
WORKFLOW="gemini-budget-check.yml"
FULL_WORKFLOW="gemini-semantic-check.yml"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)"
POLL_ATTEMPTS="${POLL_ATTEMPTS:-12}"
POLL_WAIT="${POLL_WAIT:-10}"

hr() { printf '\n\033[1m=== %s ===\033[0m\n' "$1"; }
ok()  { printf '\033[32m%s\033[0m\n' "$*"; }
bad() { printf '\033[31m%s\033[0m\n' "$*"; }
info(){ printf '%s\n' "$*"; }

require_gh() {
  if ! command -v gh >/dev/null 2>&1; then
    bad "gh not found. Install the GitHub CLI, then: gh auth login"
    exit 2
  fi
  if ! gh auth status >/dev/null 2>&1; then
    bad "gh is not authenticated. Run: gh auth login"
    exit 2
  fi
  if [ -z "$REPO" ]; then
    bad "Could not determine the repository from git remotes."
    exit 2
  fi
}

# Dispatch a workflow and stream its step log to stdout. Returns the run id.
run_workflow() {
  local wf="$1"
  if ! gh workflow run "$wf" --repo "$REPO" >/dev/null 2>&1; then
    bad "gh workflow run $wf failed. Does the workflow exist on the remote?"
    return 1
  fi
  # The run needs a moment to register before its id is visible.
  local id=""
  for _ in $(seq 1 10); do
    id="$(gh run list --repo "$REPO" --workflow "$wf" --limit 1 \
            --json databaseId -q '.[0].databaseId' 2>/dev/null)"
    [ -n "$id" ] && [ "$id" != "null" ] && break
    sleep 3
  done
  if [ -z "$id" ]; then bad "Dispatched, but no run id appeared."; return 1; fi
  info "Dispatched $wf -> run $id"

  local i=1
  while [ "$i" -le "$POLL_ATTEMPTS" ]; do
    local concl
    concl="$(gh run view "$id" --repo "$REPO" --json status,conclusion \
             -q '.status + " " + (.conclusion // "")' 2>/dev/null)"
    case "$concl" in
      completed*)
        gh run view "$id" --repo "$REPO" --log 2>/dev/null \
          | sed 's/\x1b\[[0-9;]*m//g' \
          | grep -vE '^\s*$' \
          | sed 's/^[0-9T:.Z-]* //'
        printf '\n__RUN_ID__%s\n' "$id"
        return 0
        ;;
    esac
    i=$((i + 1))
    sleep "$POLL_WAIT"
  done
  bad "Timed out waiting for run $id. Check: gh run view $id --repo $REPO"
  printf '\n__RUN_ID__%s\n' "$id"
  return 1
}

# ---------- mode: history (zero requests) ----------
if [ "$MODE" = "--history" ]; then
  require_gh
  hr "Recent Gemini runs (no requests spent)"
  gh run list --repo "$REPO" --limit 12 \
    --json workflowName,displayTitle,status,conclusion,createdAt,url \
    -q '.[] | select(.workflowName | test("Gemini")) |
         "\(.createdAt[0:19])  \(.conclusion // .status)\t\(.workflowName): \(.displayTitle)"' \
    2>/dev/null || bad "Could not list runs."
  exit 0
fi

require_gh

# ---------- stage 1 + 2: budget check (at most 1 request) ----------
hr "Stage 1+2: auth and liveness (costs at most 1 request)"
info "Repo: $REPO"
info "This spends AT MOST ONE generation request. The auth check is free."
info ""
BUDGET_LOG="$(run_workflow "$WORKFLOW")"

if printf '%s' "$BUDGET_LOG" | grep -q 'RESULT: budget-available'; then
  ok "VERDICT: budget-available — the key works and a generation request succeeded."
elif printf '%s' "$BUDGET_LOG" | grep -q 'RESULT: capacity-blocked'; then
  bad "VERDICT: capacity-blocked — 503. This is CAPACITY, not quota. Try later."
elif printf '%s' "$BUDGET_LOG" | grep -q 'RESULT: quota-exhausted'; then
  bad "VERDICT: quota-exhausted — no budget today. Resets midnight Pacific."
elif printf '%s' "$BUDGET_LOG" | grep -q 'RESULT: model-unavailable'; then
  bad "VERDICT: model-unavailable — this key cannot use that model id."
elif printf '%s' "$BUDGET_LOG" | grep -q 'RESULT: auth-blocked'; then
  bad "VERDICT: auth-blocked — the secret is invalid or lacks permission."
else
  bad "VERDICT: inconclusive. Read the log above."
fi

# Only continue to the expensive stage if the cheap stages were healthy.
if ! printf '%s' "$BUDGET_LOG" | grep -q 'RESULT: budget-available'; then
  info ""
  info "Skipping stage 3 — the cheap stages are not healthy, so the"
  info "expensive one cannot succeed either. No further requests spent."
  exit 0
fi

if [ "$MODE" != "--full" ]; then
  info ""
  info "Stage 3 (semantic) skipped. Re-run with --full to test real output."
  info "This costs 1 more request and tells you whether Gemini is actually usable."
  exit 0
fi

# ---------- stage 3: semantic (at most 1 further request) ----------
hr "Stage 3: semantic check (costs 1 more request)"
info "Sends the eight reference articles. Exits 0 only if the expected"
info "two men's events are produced and women's articles are excluded."
info ""
SEM_LOG="$(run_workflow "$FULL_WORKFLOW")"

if printf '%s' "$SEM_LOG" | grep -q '^PASS'; then
  ok "VERDICT: usable — Gemini produced correct, verified news events."
  ok "The semantic path is working. It is now safe to consider enabling it."
elif printf '%s' "$SEM_LOG" | grep -q 'FAILED'; then
  bad "VERDICT: wrong output — Gemini answered but the events are incorrect."
  bad "Read the FAILED list above; it names the exact defect."
elif printf '%s' "$SEM_LOG" | grep -q 'HTTP 503'; then
  bad "VERDICT: capacity-blocked again — 503 on the real payload."
  bad "A tiny probe succeeds but a full article batch does not. That is"
  bad "the size hypothesis: large inputs may hit a capacity tier the"
  bad "small probe never reaches. Test with ONE article to confirm."
else
  bad "VERDICT: inconclusive. Read the log above."
fi


# ---------- note appended by the author ----------
#
# EXPECTED SPEND
#   (no args)     at most 1 request
#   --full        at most 2 requests (only if stage 1+2 was healthy)
#   --history     0 requests
#
# The script NEVER runs a stage whose predecessor failed, so a bad day
# costs 1 request rather than 12.
