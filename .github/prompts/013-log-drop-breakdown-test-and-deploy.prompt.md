---
name: BKH — Log per-source news drop breakdown, then test and deploy in one pass
description: Adds per-source and per-reason news-ingest diagnostics to the nightly pipeline log, so a source silently contributing zero articles is distinguishable from a source that failed. Includes the offline test and the deploy in the same task, because the change is log-output only and cannot alter data or spend Gemini requests.
argument-hint: "Add drop diagnostics + test + deploy in one pass. Log-only change, zero Gemini cost."
agent: agent
---

You are working in the **Min BKH-app** repository (`/home/lm/Dev/BKH pwa app`).
This is a **small, additive, log-only change** followed immediately by a test
and a deploy. The change cannot affect user-visible output — but it *matters*,
because it is the diagnostic we have needed since B-006.

## Why this exists

Tonight's 03:30 UTC nightly is the **first live run of the Göteborgs-Posten
feed** (commit `c15d9c9`, deployed `36783391226`).

The pipeline already reports a **total** drop count:

```
news: 6 candidates, 66 dropped before Gemini
```

and already records per-source health in `freshness.sourceStatus`:

```
{"rss:BK Häcken":"ok","rss:Göteborgs-Posten":"ok", ...}
```

**Together those two are ambiguous.** If GP yields 0 Häcken articles, the log
still says `ok` and the total barely moves — indistinguishable from a source
that contributed 20 articles and had 19 dropped for "no Häcken relation".

That is precisely why B-006 took hours to diagnose instead of minutes. We had
`ok` and a number, and no way to attribute the number. **Do not repeat that.**

## Absolute constraints

- **Spend ZERO Gemini requests.** No `npm run pipeline`, no `gemini:*` command,
  no workflow dispatch that invokes the model.
- **Do NOT modify `public/data/app.json`.** Do not regenerate, stage, or commit
  it. This change must not alter data.
- **Do NOT modify `SYSTEM_INSTRUCTION`** in `pipeline/src/gemini.ts`.
- **Do NOT add or alter any workflow step** that runs the pipeline or references
  `GEMINI_API_KEY`. If you think one is needed, STOP and report.
- **Do NOT change filtering behaviour.** This is **observability only**. Not one
  candidate may be kept or dropped differently after this change. If your edit
  would alter which articles survive, it is wrong — stop and report.
- Do not touch the Gemini prompt, `docs/ENHANCEMENTS.md`, or B-003/B-004/B-005.
- No `git reset`, `git revert`, or force-push. Forward-only.

## Progress reporting

**Post one short status update roughly every five minutes, and no more often.**
Post it and keep working. Never stop to ask permission on a routine step.

---

# Part 1 — Read the code before changing it

The data you need **already exists**. Do not add new collection logic, do not
re-fetch anything, do not change `prefilterNews`.

Three facts, already verified:

1. `prefilterNews()` returns `{ candidates, dropped }`, where each dropped entry
   is `{ url: string; reason: string }`. Reasons are stable strings:
   `"outside date window"`, `"advertisement"`, `"no Häcken relation"`,
   `"general allsvenskan, no Häcken relation"`, `"over candidate cap"`.

2. `pipeline/src/run.ts:390` **already destructures the dropped array**:
   ```ts
   const { candidates: prefiltered, dropped } = prefilterNews(news, { windowDays, known });
   ```
   It is currently used only for `dropped.length`.

3. `pipeline/src/run.ts:396` already logs the total. You are **adding detail to
   an existing log site**, not creating a new logging subsystem.

Read those sites yourself and confirm all three. Do not trust this briefing over
the code.

## Part 2 — What to add

At the existing log site in `collectNews`'s caller, extend the diagnostic so the
nightly log answers, per source and per reason:

- how many items each source **fetched** (`feed.items.length`)
- how many of those **survived** to become candidates
- how many were **dropped**, broken down **by reason**
- which publisher each dropped item came from

Notes on doing this well:

- `dropped` entries carry only `{ url, reason }`. To attribute a drop to a
  publisher, map `url` → publisher using the news items already in scope. If
  that proves awkward, it is acceptable to log **per-reason totals** plus
  **per-source fetched counts**, as long as the two together make a
  zero-contribution source visible. State clearly in your report which of the
  two you implemented.
- Aggregate, do not spam. One line per source plus one summary line is
  preferable to 200 lines.
- Match the existing `console.log` style in `run.ts`. Do not introduce a
  logging library.
- Do not use `console.error` for normal reporting — that would make routine
  runs look like failures in CI output.

**A source that fetched items but contributed zero candidates must be obvious in
the log.** That is the whole point.

## Part 3 — Test it offline, without touching the network or the model

Add a focused unit test that pins the behaviour. Requirements:

- It must **not** perform network I/O and must **not** call Gemini.
- Cover at minimum: a source contributing some candidates, and a source
  contributing **none** — asserting the zero-contribution case is
  distinguishable in the reported breakdown.
- Read source as **text** where you need the real implementation. Note that
  `pipeline/src/geminiSemanticEval.ts` calls `main()` at module scope, so
  importing it executes a live request — never import it in a test.

Then run the full gate:

```
npm run lint
npm run typecheck
npm test
```

All must pass. Current baseline is **349 tests across 16 files**; your new tests
must raise the count. **If the count does not go up, your test is not running —
investigate rather than assuming it passed.**

## Part 4 — Scope check, then commit

Exactly **two files** should be modified:

- `pipeline/src/run.ts` — the extended log line
- `pipeline/src/newsPrefilter.test.ts` (or a sibling test file) — the new test

Confirm with `git status --porcelain --untracked-files=no` and
`git --no-pager diff --stat`. If anything else appears, **STOP and report**.

Commit message:

```
Log per-source news drop breakdown

The nightly log reported a total drop count and per-source ok/failed
status, but never attributed drops to a source. A source could fetch
successfully yet contribute zero articles, and the log could not
distinguish that from a source feeding the pipeline normally.

This is the diagnostic whose absence made B-006 take hours: we had "ok"
and an unattributed number. Now every source reports fetched, kept, and
dropped-by-reason counts.

Log-output only. No candidate is kept or dropped differently. app.json
is unchanged and was not regenerated.
```

## Part 5 — Deploy, and verify the artifact

Push to `main`. This triggers `deploy.yml`, which runs checkout → npm ci →
typecheck/test → build → upload → deploy. It does **not** run the pipeline and
does **not** reference `GEMINI_API_KEY`, so the Gemini cost of this push is
**zero**.

After the run completes, verify bytes rather than trusting a green check:

```
git show HEAD:public/data/app.json | sha256sum
curl -s https://danielomazarino.github.io/Min-BKH-app/data/app.json | sha256sum
```

They must be **identical**. They will be — this change cannot alter data. **If
they differ, STOP and report.**

## Part 6 — Report back

State precisely:

- commit SHA, deploy run ID and conclusion
- served vs committed hash comparison
- **that `app.json` was not regenerated and no data changed** — this is the
  expected and correct result
- which of the two Part 2 reporting shapes you implemented (per-drop publisher
  attribution, or per-reason totals + per-source fetched)
- the new test count
- anything you could **not** verify

Do not claim the diagnostics are useful until you have seen a real nightly log
line containing them. **You have not — tonight's run has not happened yet.**
Say so.

## Do not claim

- that the GP feed works — it has never run in production
- that tonight's nightly will succeed
- that Gemini is fixed — it is currently returning `503 UNAVAILABLE`, so the
  nightly will most likely use the deterministic fallback. That is the expected
  state, not a new fault. It also means GP's **first** exercise happens on the
  deterministic path, so we will **not** learn whether it behaves correctly
  when Gemini *is* working.

## Timing note

It is currently approximately **2026-09-30 22:20 UTC**. The availability probe
fires at **02:00Z** and the nightly at **03:30Z** — roughly 3h40m and 5h10m away.

If this task finishes after **03:30Z**, the nightly has already run with the
*old* logging. Say so in your report, because it changes what the next step is.
Do not assume; check the clock with `date -u`.

## One correction to avoid

Session context may state the date as `2026-10-01`. That is **local time**
(CEST, UTC+2). `date -u` returns `2026-09-30`. **Both are correct** — they are
different timezones, not a discrepancy. Midnight in CEST is 22:00 UTC the
previous day. Check `date -u` for scheduling decisions, and do not report a
conflict where there is none.