---
description: Make the Brief e2e discipline assertions data-driven instead of keyed to one player's name (E-005 follow-up)
---

# Replace the name-keyed e2e discipline assertion with a data-driven one

## HARD BUDGET CEILING: **0 Gemini API requests. State this before you start.**

This task touches no LLM code path.

**Do not run:** `npm run pipeline` (12 requests), `npm run gemini:status` (1),
`npm run gemini:size-probe` (up to 4), `npm run gemini:eval`,
`npm run gemini:recheck`, anything under `.github/workflows/gemini-*.yml`.

Do not re-add `GEMINI_API_KEY` to `data-update.yml`. It was deliberately
removed (commit `1b97168`).

---

## Part 0 — Context you must NOT re-derive

E-005 is done in code but **not committed** and **not in the generated data**.
`docs/ENHANCEMENTS.md` has a 2026-09-30 closeout. Read it and copy that
reasoning.

### What E-005 changed (uncommitted, in the working tree)

`computeSeasonDiscipline()` in `pipeline/src/discipline.ts` gained a **required**
5th argument `currentSquad: CurrentSquad`, where

```ts
CurrentSquad = { players: Array<{ playerId; playerName }>, known: boolean }
```

- `known: false` → squad query failed → filtering **skipped**, ledger intact.
- A player not in the squad whose status was `at_risk` / `suspended_next` is
  demoted to a new terminal status `"departed"`.
- `served` / `red_suspended` / `unknown` are **preserved** — they are factual
  historical records, not forward-looking claims.
- Card history (`warningCount`, `warningsUntilSuspension`, `relevantWarnings`,
  `servedAt`, `redCards`) is **never** touched. Only the risk classification moves.
- `departed?: boolean` is set on **every** non-squad row.
- `PlayerDiscipline` gained `departed?: boolean`; `DisciplineStatus` gained
  `"departed"` in **both** unions (`discipline.ts` and `types.ts`) plus the zod
  enum in `validate.ts`.

### The UI-side mapping

`cstatFor()` in `app/shared/format.ts` now short-circuits on
`d.departed || d.status === "departed"` and returns
`state: "Spelade under säsongen"`, `severity: "other"`.

**Read this carefully — it is the reason for this task.** The check is on
`d.departed` (the flag), NOT on the status string, and that is deliberate. The
engine sets the flag on every non-squad row but only rewrites the *status* for
forward-looking cases. A departed player whose status was preserved as `served`
or `none` still carries `departed: true` plus pending warnings, and would
otherwise fall through to the generic `pending > 0` branch and render
**"1 varning kvar"** — the exact misleading claim E-005 exists to remove.

`cstatFor` is reached from `Brief.tsx:342` and `Squad.tsx:155,205`. Both pages
pass rows through `currentSquadDiscipline()` **first**, so a departed row is
already dropped in the current UI. The mapping is defence in depth.

---

## The defect in the test suite

`e2e/brief.spec.ts:192-197`:

```ts
test("a player who has left the club is not shown as a current risk", async ({ page }) => {
  // Amor Layouni was sold during the season but the ledger spans the whole
  // season, so he appeared as "at_risk" for a team he no longer plays for.
  if ((await page.getByTestId("discipline").count()) === 0) test.skip(true, "no discipline cases");
  await expect(page.getByTestId("brief-page")).not.toContainText("Amor Layouni");
});
```

**This test is weak in three independent ways.**

1. **It passes for the wrong reason.** `not.toContainText("Amor Layouni")` is
   also satisfied by a blank Brief, a crashed render, an empty data file, or a
   layout that never renders the discipline panel. It cannot distinguish
   "correctly excluded" from "broken".
2. **It covers exactly one player, forever.** It asserts a hardcoded name. The
   next transfer will not be covered by any test, and the test cannot fail for
   anyone but Layouni.
3. **It no longer tests the code path that exists.** The exclusion is now
   enforced in `computeSeasonDiscipline` (pipeline) *and* `cstatFor` (UI). This
   test can only observe the composition of the two. It cannot detect a
   regression in either.

A data-driven assertion derived from `squadStats` vs `discipline` covers every
present and future departure, and fails loudly when the panel is broken.

---

## Part 1 — What to build

Replace the single name-keyed assertion with assertions that derive their
expectation from the data.

**Available in the page under test** (`app/pages/Brief.tsx`):

```html
<div data-testid="discipline" data-count="{urgent.length}">
  <div class="cstat-group" data-testid="discipline-group" data-severity="suspended|at-risk|other">
    <h3 data-testid="discipline-group-label">
    <div class="cstat ..." aria-label="{playerName}, {state}. {total} gula kort den här säsongen."
         data-testid="suspended-player|at-risk-player">
```

Note the row exposes `aria-label` containing the player name and the `state`
string, and `data-testid="discipline"` carries `data-count`.

**The data is available in the spec** — read
`public/data/app.json` (or `dist/data/app.json`) in the test and compute:

- `squadNames` = every `squadStats[].playerName`
- the set of `discipline[]` entries whose `status` is `at_risk` or `suspended_next`
- the set of those that are **not** in `squadNames`

**Required assertions.**

1. **No rendered discipline row belongs to a non-squad player.** Collect every
   player name from the rendered rows (via the `aria-label`s) and assert the
   intersection with the at-risk non-squad set is empty.
2. **The count is honest.** `data-count` on `[data-testid="discipline"]` equals
   the number of rendered `.cstat` rows. This is the E-001 invariant and it
   should be asserted where the data is available, not just the count.
3. **The panel is genuinely rendered before asserting absence.** Guard with an
   explicit precondition — if `data-count` is `0` **and** the ledger in the data
   genuinely has qualifying cases, that is a **FAILURE**, not a skip. Only skip
   when the data itself has no qualifying cases.
4. **No row states a warning-away claim for a player who cannot be suspended.**
   Assert no rendered `aria-label` matches `/varning kvar/` for a name that is
   absent from `squadNames`.

Assert on **names + status**, not on the Swedish `state` string, so a wording
change does not break the test. Exception: assertion 4 must match the string
pattern because the misleading claim *is* a string.

**Keep a regression test for the specific historical case.** Somewhere, keep a
test that pins the *known* 2026-09-27 incident shape so it cannot silently
return: an article set where a pre-match service article would be absorbed into a
post-match result event. See "Out of scope" — that is B-004, do not implement
it, just do not delete the fixture that would prove it.

---

## Part 2 — Test-data reality check, do this BEFORE writing the test

The committed `public/data/app.json` is **stale by design**. The pipeline was
deliberately not re-run, so Layouni is still `at_risk` in the file:

```
violations: [('Amor Layouni', 'at_risk')]
```

Consequences you must handle explicitly, not by skipping:

- A test that asserts "no non-squad at_risk player exists in the data" will
  **FAIL** against the current committed file. That failure is expected and
  correct. Decide deliberately which of these you are testing:
  - **(a) the data contract** — assert against the file, accepting that it
    fails until the next nightly regenerates it; or
  - **(b) the UI behaviour** — build the assertion from a synthetic fixture the
    test controls, so it is deterministic and does not depend on regeneration.
- **Prefer (b) for the e2e suite.** An e2e test that fails until an unrelated
  scheduled job runs is a broken test. Use a Playwright route/response override
  or a dedicated fixture so the test is hermetic and passes today.
- If you choose (a), the test MUST be marked to reflect that it is pending data
  regeneration, and you must say so in your report. Do not quietly leave a
  failing test.

Look at how the existing e2e specs stub data before inventing a mechanism — check
`e2e/brief.spec.ts` and `e2e/offline.spec.ts` for an existing pattern.

---

## Part 3 — Out of scope. Do not drift.

- **B-004, Gemini false merges.** Different defect, different layer. Do not open
  `SYSTEM_INSTRUCTION` in `pipeline/src/gemini.ts`. Do not add prompt text. Do
  not add deterministic clustering. The pre-match/post-match merge is exactly
  the case a regex misfires on.
- **The Gemini 503.** Sector-wide, 84 third-party issues in 48h. Not ours.
- **E-006 – E-009.** Their premises no longer exist (no `registry.json`, no
  `apiFootballId`, `FormerPlayers.tsx` is a Wikidata search). Do not attempt
  them and do not restore the old registry.
- **E-001 – E-004.** Fixed. Do not "improve" them.
- **Do not commit.** E-005 is uncommitted in the working tree. Leave everything
  for review; do not stage or commit anything.
- **Do not run `npm run pipeline`.** Do not edit `public/data/app.json`.
- **No new dependencies.** Playwright 1.63.0 is already installed.

---

## Part 4 — Known, expected, harmless

- Test logs contain `gemini: model ... attempt 1/3 failed` lines. These are
  `gemini.test.ts` output. **Zero API requests.** Not a bug.
- `gemini-budget-check.sh` always exits 0. Do not run it.
- The service worker caches `/data/*.json` with `NetworkFirst`, so a browser
  screenshot can show stale data after a deploy. Use `curl` for data claims.
- `docs/ENHANCEMENTS.md` and `AGENTS.md` were already modified/added before this
  task. Not yours.

---

## Part 5 — Verification

```
npx vitest run
npx playwright test e2e/brief.spec.ts
npx playwright test            # full e2e if time permits
npx tsc -b
npm run lint
```

**Baseline: 346 unit tests across 16 files.** Report the count before and after.
It must not decrease.

For e2e, report the actual pass/fail counts. If you skip a test via
`test.skip`, say which and why. **Never report an e2e test as passing when it
was skipped** — a skipped test proves nothing.

---

## Part 6 — Report format

1. Unit test count before → after.
2. e2e pass/fail/skip counts, with the skip reasons.
3. Which data source your new assertions use, and **why** (see Part 2 — you must
   have chosen (a) or (b) deliberately).
4. How you handled the stale `app.json`, in concrete terms.
5. Confirmation that the assertions would catch the **next** transfer, not just
   Layouni. Explain how, mechanically.
6. What you did **NOT** change.
7. What remains **unverified.**

Use "verified", "observed", "not yet tested". Never say "working" for something
you only proved compiles.

---

## Definition of done

- [ ] No e2e assertion is keyed to a hardcoded player name
- [ ] Assertions derive from `squadStats` vs `discipline`, covering any departure
- [ ] Broken/empty render is a FAILURE, not a silent pass
- [ ] e2e tests are hermetic — pass today, not dependent on a scheduled job
- [ ] 346 → 346+N unit tests, never fewer
- [ ] `tsc -b`, `lint` clean
- [ ] e2e actually run, counts reported honestly including skips
- [ ] 0 Gemini requests, no workflow file edited
- [ ] `public/data/app.json` untouched, nothing committed
- [ ] `docs/ENHANCEMENTS.md` updated to reflect what is actually true

**Stop after this pass.** Do not begin B-004 or E-006 – E-009.
