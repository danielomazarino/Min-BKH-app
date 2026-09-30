---
description: Move the departed-player exclusion for discipline risk from the UI layer into the pipeline (E-005)
---

# E-005 — Scope the discipline ledger to the current squad, in the pipeline

## HARD BUDGET CEILING: **0 Gemini API requests. State this before you start.**

This task must not touch the Gemini API. It touches no LLM code path at all.

**Do not run these commands:**

- `npm run pipeline` — regenerates production data (12 Gemini requests).
- `npm run gemini:status` — spends 1 request.
- `npm run gemini:size-probe` — spends up to 4.
- `npm run gemini:eval` / `npm run gemini:recheck` — spend requests.
- Anything under `.github/workflows/gemini-*.yml`.

`GEMINI_API_KEY` is deliberately **not** injected into the nightly pipeline
(commit `1b97168`). Keep it that way. Do not re-add it.

---

## Part 0 — Context you must NOT re-derive

The repo's `docs/ENHANCEMENTS.md` has a session closeout for 2026-09-30 that
already records all of this. Read the "Session closeout — 2026-09-30" and
"Doc-sync audit 2026-09-30" sections. Copy that reasoning; do not re-investigate
it.

### The defect

`computeSeasonDiscipline()` in `pipeline/src/discipline.ts` walks all finished
matches and keeps **any** player who collected a card, with no check against
current squad membership.

The result is a season ledger that includes players who have since left the club.
Live committed data (`public/data/app.json`, 27 squad players, 18-entry ledger)
reproduces this exactly:

```
at_risk/suspended for non-squad: [('Amor Layouni', 'at_risk')]
```

Amor Layouni was sold by BK Häcken. He is correctly absent from `squadStats`, but
he is still `at_risk` in the ledger because the ledger spans the whole season
including matches he played before the transfer.

### Why this is wrong, in domain terms

"En varning kvar" (one warning from a suspension) implies a suspension in a
competition Häcken plays in. He cannot be suspended by Häcken — he no longer
plays for the club. A supporter reading that would be misinformed.

### Why a user cannot see it today — and why that is not the point

`app/shared/format.ts` has `currentSquadDiscipline()`, which filters the ledger
against the current squad at the **UI layer**. So the app does not display the
bug right now.

E-005 exists anyway because it is the **mechanism that stops this recurring on
every future transfer**. Today the guarantee lives in presentation code. Any new
consumer of the ledger — a different screen, an export, a notification, a test
asserting on raw data — inherits the defect. The invariant belongs in the
pipeline, and the UI filter then becomes defence in depth rather than the only
guard.

### The precise tension you must respect

**Historical cards must NOT be deleted.** The season ledger is a record of what
happened during the season. Layouni's yellow cards were real. Destroying them
loses genuine data and would make the historical record wrong.

Only the **current risk classification** is wrong. So the fix must change what
status a departed player carries — not whether they appear in the ledger at all.

Design the exact shape yourself, but it must satisfy all of:

1. No player who is not in the current men's `squadStats` can carry status
   `at_risk` or `suspended_next`.
2. Departed players' historical card data is **retained** in the ledger.
3. `served` and `red_suspended` historical entries for departed players are not
   silently rewritten into something misleading.
4. The empty/insufficient-squad-data case is handled explicitly, not by accident.

### Trap that has already bitten this repo

`squadStats` is a **LIST** and the field is **`playerName`**, NOT `name`.
Reading `p.name` yields an empty set, which makes **every** player look departed
and silently inverts the whole fix. This happened during the 2026-09-28
investigation. Check the field name against
`app/shared/format.ts`'s `currentSquadDiscipline()` — it is already correct
there; reuse its approach.

Also note: `computeSeasonDiscipline` is called at `pipeline/src/run.ts:298`,
**before** you need to confirm whether `squadStats` is available at that point.
If it is not, resolve the ordering rather than passing an empty set and calling
it done. An empty squad set must NOT be treated as "nobody is in the squad" and
wipe every status — that would be a catastrophic silent regression.

---

## Part 1 — Implement

1. Add a failing test first. In `pipeline/src/discipline.test.ts` (16 tests
   currently), assert that a player absent from the supplied current squad cannot
   come back with `at_risk` or `suspended_next`, while still appearing in the
   output with their history intact. **Show the test failing before the fix.**
2. Thread the current-squad set into `computeSeasonDiscipline()`. The call site
   is `pipeline/src/run.ts:298`; its signature is
   `(events, rule, finishedMatchDates, nextMatch)`.
3. Keep the parameter explicit and required. An optional parameter that defaults
   to "no filtering" recreates the bug the moment a caller forgets it.
4. Update `run.ts` to pass the real squad set.
5. Update all 16 existing callers in `discipline.test.ts`. Read them first —
   some assert on players who are not in any squad, and they will need squad
   fixtures or a deliberate decision that the test is exercising pure
   classification. Do not blanket-edit them into passing.

---

## Part 2 — Out of scope. Do not drift into these.

- **B-004, Gemini false merges.** This is a different defect in a different
  layer. Do not open `SYSTEM_INSTRUCTION` in `pipeline/src/gemini.ts`. Do not add
  prompt text. Do not add deterministic clustering. It is deferred and it is not
  part of this pass.
- **The Gemini 503.** A sector-wide capacity incident is ongoing (84 third-party
  GitHub issues in 48h matching the exact API error string). It is not ours to
  fix and it is not related to this task.
- **E-006, E-007, E-008, E-009.** Their stated premises no longer exist. The
  `registry.json` / `former-players.json` pipeline is gone; `apiFootballId`
  appears nowhere in the repo; `FormerPlayers.tsx` is now a Wikidata-backed
  search. Do not attempt them, and do not "restore" the registry.
- **E-001–E-004.** Already fixed. If you believe otherwise, say so in your report
  with evidence rather than editing them.
- **Do not edit `public/data/app.json`.** The pipeline is not to be run. If you
  want to show the effect, do it in a test, not in committed data.
- **Do not commit.** Leave the working tree for review.

---

## Part 3 — Known, expected, harmless

- The deploy build log contains lines like
  `gemini: model gemini-3.8-flash attempt 1/3 failed — Unexpected token 'o'`.
  These are `pipeline/src/gemini.test.ts` output from the unit tests. **Zero API
  requests.** Not a bug. Do not try to fix it.
- `gemini-budget-check.sh` always exits 0. A green checkmark is meaningless; the
  `RESULT:` line is the answer. You should not be running it at all.
- The service worker caches `/data/*.json` with `NetworkFirst`, so a browser
  screenshot can show stale data after a real deploy. Use `curl` for anything
  data-related.

---

## Part 4 — Verification you must perform

Run and report actual output, not a claim:

```
npx vitest run
npx tsc -b
npm run lint
npm run pipeline:validate
```

**Report the unit test count before and after.** Baseline is **326 passed across
16 files**. Your change must not reduce that number, and any new test must be
additive.

Then confirm the acceptance criterion against the data as it stands, and be
explicit that you did **not** regenerate it:

```
python3 -c "
import json
d=json.load(open('public/data/app.json'))
squad={p['playerName'] for p in d.get('squadStats',[])}
bad=[(e.get('playerName'),e.get('status')) for e in d.get('discipline',[])
     if e.get('playerName') not in squad and e.get('status') in ('at_risk','suspended_next')]
print('violations:',bad)
"
```

This will **still print Layouni** — correctly, because you are forbidden from
re-running the pipeline. What you must demonstrate instead is that the *new code
path* would not produce him. Prove that with the unit test from Part 1. State
plainly: the committed data is unchanged, the invariant is now enforced in code,
and the file will correct itself on the next scheduled nightly.

---

## Part 5 — Report format

Answer these, in this order, with evidence:

1. Test count before → after.
2. The failing-test output from Part 1, **before** the fix.
3. The exact signature change to `computeSeasonDiscipline()` and how
   `run.ts:298` now supplies the squad set.
4. How you handled the empty-squad-data case, and why it is not a silent wipe.
5. Which of the 16 existing tests you changed and why each needed it.
6. Confirmation that Layouni's historical card data is retained, with the test
   that proves it.
7. What you did **NOT** change.
8. What remains **unverified** — especially: no device testing, no e2e run
   unless you actually ran it, and committed data deliberately unchanged.

Use "verified", "observed", "not yet tested". Never say "working" for something
you only proved compiles.

---

## Definition of done

- [ ] A test that fails before the fix and passes after
- [ ] No departed player can carry `at_risk` / `suspended_next`
- [ ] Departed players' historical cards retained
- [ ] Empty-squad case handled explicitly, not as a wipe
- [ ] Test count 326 → 326+N, never lower
- [ ] `tsc -b`, `lint`, `pipeline:validate` clean
- [ ] No Gemini request spent, no workflow file edited
- [ ] `public/data/app.json` untouched, nothing committed
- [ ] `docs/ENHANCEMENTS.md` E-005 status updated to reflect what is true

**Stop after this pass.** Do not begin E-006–E-009 or B-004.
