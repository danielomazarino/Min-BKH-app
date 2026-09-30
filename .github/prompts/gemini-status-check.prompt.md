---
description: Run the one-request Gemini reachability check and report the classification
---

# Task: run the Gemini status check, report the result, change nothing

## Goal

Answer one question: **can the Gemini API serve a generation request right now?**

The instrument already exists and is already cost-capped. Your job is to run it
once, read the classification, and report it. You are NOT diagnosing anything,
fixing anything, or improving anything.

## HARD BUDGET CEILING: 1 request. State this before you start.

This is the single most important constraint. A previous incident spent an
entire day's allowance by running the full pipeline, which multiplies one
logical call into 4 models × 3 attempts = 12 requests.

**`npm run pipeline` is FORBIDDEN in this task.** It is the 12-request path.
So is everything else listed under "Do not run" below.

The command you will run spends **0 or 1** generation requests. If you are ever
tempted to run it twice because the first answer was unpleasant, do not. A
failure is a complete, acceptable answer.

## The command

```bash
cd "/home/lm/Dev/BKH pwa app"
npm run gemini:status
```

`gh` is already authenticated via keyring, so this dispatches
`.github/workflows/gemini-budget-check.yml` and streams its log. No browser, no
login, no token paste, no local key. The secret is read on the runner.

**It normally takes 1–3 minutes** (dispatch + checkout + polling). Let it run
to completion. Do not interrupt it and do not re-dispatch because it feels slow.

If the script reports a polling timeout, that is not a Gemini failure — it means
the wrapper gave up waiting. The run ID is printed. Finish by reading the log
directly:

```bash
gh run view <RUN_ID> --log
```

## Do not run

- `npm run pipeline` — 12 requests
- `npm run gemini:status -- --full` — adds a stage-3 request
- `npm run gemini:eval` — 1 further request, and it would grade output we
  already know is defective
- `npm run gemini:recheck` — 1 further request
- `npm run gemini:size-probe` — 4 requests
- `gh workflow run <anything>` directly — go through the script
- Any retry, loop, or re-dispatch

## Also forbidden

- Do not edit any file in `pipeline/`, `app/`, or `.github/`.
- Do not commit, push, or create a branch.
- Do not run the unit test suite or e2e tests. They are irrelevant to this
  question and waste time.
- Do not "improve" the script, the workflow, or the classification logic, even
  if you think you see a problem with them.

## Known, expected, harmless

The `gemini-budget-check.sh` script **always exits 0**, including on failure.
A green checkmark on this workflow means nothing. The answer is in the log text,
specifically the line beginning `RESULT:`. Do not interpret a green run as
success.

## What to report

Report these, concisely:

1. The `RESULT:` classification, verbatim — one of:
   `budget-available`, `quota-exhausted`, `capacity-blocked`,
   `model-unavailable`, `auth-blocked`, `no-key`, `network-blocked`,
   `unexpected-status`, `auth-check-failed`.
2. The run ID and run URL.
3. Requests actually spent (the script prints this; it is 0 or 1).
4. The HTTP status of each of the two calls, if visible in the log.
5. If the classification was not `budget-available`, the verbatim error body —
   Google's 429/503 messages usually name the exact reason, and that reason is
   the most valuable output of the whole exercise.

Use precise language. Say "observed", "verified", or "inconclusive". Do not
write "Gemini is working" when you only proved a request was accepted.

## How to interpret — copy this reasoning, do not re-derive it

**`budget-available`**
- Proves: the secret is valid AND at least one generation request succeeded.
- The API exposes **no balance endpoint**. The remaining count is UNKNOWN.
  "20 requests/day" is an assumption, not a measurement. Do not quote it.
- Does **NOT** prove semantic quality. Run `36215617435` returned HTTP 200 with
  zero usable events. A 200 is not a working feature.

**`capacity-blocked` (503)**
- Capacity, NOT quota. These are different problems with different fixes and
  must not be conflated.
- This is a valid outcome. Report it and stop.

**`quota-exhausted` (429)**
- No free-tier budget remains. Resets midnight Pacific.
- Complete and acceptable. The deterministic fallback in
  `pipeline/src/newsEvents.ts` carries the news feed; the app is healthy.
- If the body states an actual requests-per-day number, quote it verbatim — it
  would correct the assumed figure.

**`model-unavailable` (404) / `auth-blocked` (401, 403)**
- The key cannot use the model, or the secret is invalid/revoked.
- Also acceptable. Report and stop.

**`no-key`**
- The `GEMINI_API_KEY` repository secret is missing or empty. Stop and say so
  plainly. Do not attempt to work around it by finding a key elsewhere.

## Out of scope — do not drift into these

There is a known open defect, **B-004** in `docs/ENHANCEMENTS.md`: the Gemini
news grouping merges unrelated stories, specifically pre-match service articles
(matchtrupp, besöksinformation) into post-match result events. Two of the three
live events are false merges.

**You are not being asked to investigate or fix B-004.** Do not open
`gemini.ts`, do not read the system prompt, do not propose a prompt fix, do not
add the missing fixture assertion. If you notice something about B-004 while
reading logs, mention it in one line at most and move on.

Reachability and correctness are separate questions. This task is only the
first one.

## Definition of done

- [ ] `npm run gemini:status` ran exactly once
- [ ] Total requests spent is 0 or 1, and you can state which
- [ ] The `RESULT:` classification is reported verbatim
- [ ] Run ID and URL are reported
- [ ] No file was modified
- [ ] Nothing was committed
- [ ] No other Gemini command was run
