---
name: BKH — Fix prefilter false-negative and the Gemini eval fixture
description: Two tight fixes. (1) The deterministic prefilter discards genuine Häcken articles that name a current player but never say "Häcken". (2) The Gemini evaluation fixture has a one-character URL typo and no dead-URL guard. No Gemini request is spent.
argument-hint: "Two contained fixes. No Gemini calls, no workflow dispatch, no scope creep."
agent: agent
---

You are working in the **Min BKH-app** repository. Two contained fixes. Both
are small. Do not expand either into a redesign.

## Hard constraints — read first

- **Do NOT call Gemini.** No `gemini:*` command, no workflow dispatch, no
  `npm run pipeline`, no external API request. This task spends **zero**
  Gemini requests.
- **Do NOT run the Gemini semantic evaluation.** Not now, not "just to check".
- Do not commit anything to production files until the report at the end.
- Do not touch the CI failure in `e2e/news.spec.ts`.
- Do not touch E-005, B-002, E-006–E-009 or any other backlog item.
- Do not widen the product scope.

## Progress reporting

**Post one short status update roughly every five minutes of working time — and
no more often than that.** **Post the status and then continue working.** Never
stop to ask permission on a routine step.

---

# Fix 1 — The deterministic prefilter discards real Häcken articles

## The defect, with evidence

`prefilterNews()` in `pipeline/src/newsPrefilter.ts` keeps an article only if:

```ts
const official = item.publisher === "BK Häcken";
const mentions = mentionsHäcken(item.title, item.summary ?? "");
if (!official && !mentions) { /* DROP */ }
```

`mentionsHäcken` only matches the literal word `Häcken` / `Häckens`. It never
consults known players.

**Observed consequence** in the last evaluation run, on articles that are
plainly Häcken news:

| Article | Publisher | Outcome |
|---|---|---|
| "Gustav Lindgren gör hattrick mot Kalmar" | SVT Sport | **DROPPED** — "no Häcken relation" |
| "Inför KFF-BKH: Tillsammans ska vi göra allt vi kan…" | Kalmar FF | **DROPPED** — "no Häcken relation" |

The hattrick report — the single most newsworthy item in that set — never
reached the app. A supporter reading "Gustav Lindgren gör hattrick mot Kalmar"
should absolutely see it.

## This is a WIRING fix. Do NOT build a parallel system.

`pipeline/src/newsRelevance.ts` **already implements the correct logic**:

- `classifyRelevance(item, known)` — branches:
  1. official club source
  2. explicit Häcken mention
  3. **known Häcken person without explicit club mention** ← the missing case
- `mentionsKnownPerson(title, summary, persons)`
- `KnownPersons` — `{ currentPlayers, formerPlayers?, womenPlayers?, staff?, womenContextTerms? }`

Branch 3 exists and is correct. `run.ts` already builds `known` at line ~346
(`currentPlayers: foot.squadStats.map(p => p.playerName)`) and already applies
`classifyRelevance(n, known).relevance === "CURRENT_HACKEN"` when building
events.

**The prefilter simply never calls it.** Reuse `classifyRelevance`. Do not
invent a new matcher, a new person list, or a second relevance system.

## Required behaviour change

An article from a secondary source is **kept** when, in addition to an
official-source or Häcken-mention match, it names a known current Häcken man in
a men's context — exactly what `classifyRelevance` branch 3 already decides.

**Preserve the conservative stance deliberately built into `classifyRelevance`:**

- Women's context still wins over men's relevance. An article naming a
  women's player stays excluded.
- A Häcken mention with **no** men's evidence still returns `UNKNOWN`, not
  `CURRENT_HACKEN`. Do not weaken this to increase volume.
- Ambiguous surnames (`andersson`, `johansson`, …) must remain excluded from
  surname-only matching. Do not touch that list.

**Do not** let the prefilter become a duplicate of the whole classifier. Its
job stays cheap: date window, ads, and unambiguous noise. The person check is
the one addition.

## Wiring

`prefilterNews` currently takes `PrefilterOptions` with no person data. Add
what is needed — an optional `known?: KnownPersons` on `PrefilterOptions` is
the natural shape. **When it is absent, preserve today's exact behaviour**, so
existing callers and tests that pass no `known` do not change.

Update the production caller `run.ts` to pass the `known` object it already
builds. Do not construct a second one.

## Acceptance criteria

1. A secondary-source article naming a current Häcken man and containing no
   literal "Häcken" is **kept** by `prefilterNews` when `known` is supplied.
2. The SVT hattrick article above is kept; the Kalmar FF preview is kept.
3. An article naming a **women's** player is still dropped, even if it also
   matches loosely.
4. An article with only an ambiguous-surname match is still dropped.
5. With `known` **not** supplied, behaviour is byte-for-byte the previous
   behaviour.
6. Genuine non-Häcken noise is still dropped.
7. The number of candidates reaching Gemini can increase — that is the point.
   Do not compensate by tightening something else.

## Tests to add (`pipeline/src/newsPrefilter.test.ts`)

- keeps a known-current-player article with no "Häcken" mention
- drops a women's-player article
- drops an ambiguous-surname-only match
- unchanged behaviour when `known` is omitted
- a real `NewsItem` fixture for the SVT hattrick headline

Run the full suite. Baseline is **307 passing**; your additions must all pass
and nothing existing may break.

---

# Fix 2 — The Gemini evaluation fixture is invalid

## 2a. One-character URL typo

`pipeline/src/geminiSemanticEval.ts` line ~51 has:

```
.../matchguide-champions-league-premiar-bota-mot-fc-inter
```

`bota` must be **`borta`**. With the typo the URL returns **HTTP 404**, the
article text is unavailable, and `t7` — one of the two articles that must be
REJECTED as women's — reaches Gemini with no text at all. The primary
men/women discrimination test was running blind.

`geminiRegression.ts` and `gemini.test.ts` already have it right. This is a
local typo in the one file, not a project-wide one.

**Verified:** with `borta` restored, all eight fixture URLs return HTTP 200.

## 2b. Missing guard — a fixture must not lose its own test cases

The evaluation printed `t7: TEXT UNAVAILABLE (HTTP 404)` and **carried on**,
producing a run that looked valid but was not. Add a guard:

- After fetching article texts, check every id in `MUST_BE_REJECTED`.
- If any such article has no text, print the reason and report
  **`RESULT: fixture-invalid`** and exit **non-zero**.
- Do this **before** the Gemini request, so an invalid fixture costs **zero**
  requests.

Print the HTTP status per unavailable article so a future stale URL is obvious.

## Acceptance criteria

1. `bota` → `borta`; the URL returns 200 and text is fetched.
2. With the typo reintroduced (or any `MUST_BE_REJECTED` text missing), the
   run reports `fixture-invalid` and exits non-zero **without calling Gemini**.
3. The Gemini request count is unchanged: still exactly one `await fetch(`
   targeting the Gemini endpoint, still no retry, still no
   `synthesizeWithGemini`.
4. The audit and reporting sections are otherwise unchanged.

## Do NOT change

- The purpose of the evaluation.
- The claim-traceability rule: a claim is traceable if it maps to **at least
  one** supplied article; multi-source collective support is valid; only
  claims traceable to **no** supplied source are flagged.
- The `EXPECTED_DROPPED` constant **unless** Fix 1 changes what the prefilter
  drops — if `t2`/`t4` are now correctly kept, update that constant and say so
  in the report. Expect this: it is evidence Fix 1 worked.
- The five evaluation questions, the section structure, or the exit codes for
  other classifications.

---

# Verification before reporting

```bash
npx tsc -b                      # must exit 0 — check the exit code directly
npm run lint                    # must exit 0
npx vitest run                  # all passing, 307 + your new tests
```

Confirm the Gemini-call guarantee is still intact:

```bash
grep -c 'await fetch(' pipeline/src/geminiSemanticEval.ts
```

Do **not** run `npm run gemini:eval`, `gemini:status`, or any workflow.

## Report before anything else

1. Exactly what changed, file by file, with the reason.
2. The test count before and after.
3. Whether `t2` and `t4` are now **kept** by the prefilter, and what happened
   to `EXPECTED_DROPPED`.
4. Confirmation that a `MUST_BE_REJECTED` article with no text now aborts
   before any request.
5. Confirmation that **zero** Gemini requests were spent.
6. Anything you noticed but deliberately did not change.

**Then stop.** Do not run the Gemini evaluation. It is a separate, deliberate
step, taken only after this report.
