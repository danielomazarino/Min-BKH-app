---
name: BKH — Realistic fixture summaries + session closeout
description: Final pass of the night. (1) Add realistic summary values to the Gemini evaluation fixture so the deterministic baseline is a fair comparison. (2) Update the documentation so the next session resumes without rediscovery. Zero Gemini requests.
argument-hint: "Fixture-only correction + documentation closeout. No Gemini, no production change."
agent: agent
---

You are working in the **Min BKH-app** repository. This is the **final pass of
the working session**: a fixture correction followed by a documentation closeout.

## Absolute constraints

- **Spend ZERO Gemini requests.** Do not run `gemini:eval`, `gemini:status`,
  `gemini:recheck`, `gemini:503-recheck`, or any `gemini:*` command. Do not
  dispatch any workflow. Do not run `npm run pipeline`.
- **Do not change production news behaviour.** No edits to `newsEvents.ts`,
  `rss.ts`, `dedupe.ts`, `newsRelevance.ts`, `newsPrefilter.ts`, `classify.ts`,
  `run.ts`, or anything under `app/`.
- Do not modify `geminiRecheck.ts`.
- Do not implement deterministic story clustering.
- Do not touch unrelated backlog items or reopen completed work.

## Progress reporting

**Post one short status update roughly every five minutes of working time — and
no more often than that.** **Post the status and then continue working.** Never
stop to ask permission on a routine step.

---

# Part 1 — Realistic fixture summaries

## The verified defect

`pipeline/src/geminiSemanticEval.ts` has an 8-article `ARTICLES` fixture in
which **no item carries a `summary` value** (confirmed: zero occurrences in the
fixture block).

`pickSummary()` in `newsEvents.ts` therefore always falls through to:

```ts
return sorted[0].title;
```

So every baseline event is reported as `summaryMethod: "excerpt"` with the
summary **identical to the headline**. That is what produced the misleading
"the deterministic pipeline produces only headlines" observation.

**This is a fixture artefact, not a production defect.** In production
`rss.ts` sets `summary` from the RSS `<description>`, and the real
`bkhacken.se` feed populates it with genuine prose — verified by direct fetch,
examples 57–152 characters long, e.g. *"Bortamötet på Stadio Brianteo slutar i
en uddamålsförlust."* The live `app.json` contains only
`summaryMethod: "gemini-synthesis"` events — no `excerpt` events exist in
production at all.

## Required change

Add a realistic `summary` to each fixture article, **derived from that article's
own actual text**.

The evaluator already fetches every article body server-side
(`fetchArticleTexts`). **Read the real fetched text first, then write a summary
that faithfully reflects it.** Do not guess, do not invent a scoreline, a goal
tally, a quote, or a club that the article does not mention.

If an article's text cannot be retrieved, write a summary that is honest about
what is known from the title alone, and note it — do not fabricate.

### Fairness requirement — this matters

The fixture must be a **fair representation of what the deterministic pipeline
receives from real RSS data**, not a rigged comparison.

- Use summaries of **realistic length and register** — comparable to the real
  feed's 57–152 characters.
- Do **not** make summaries long, detailed or Gemini-like. Real RSS
  descriptions are short teasers, not articles. Writing 200-character
  summaries that summarise the whole story would manufacture a result.
- Do **not** shape summaries so that merging looks artificially easy.
- The two articles that must be rejected (`t7` Champions League guide, `t8`
  Juventus keepers) need summaries too, and those must make them **look** like
  plausible men's-team-relevant items — that is what makes the discrimination
  test meaningful.

### Preserve exactly

Article `id`, `url`, `title`, `publishedAt`, `publisher`, and every intended
semantic test case. The fixture's purpose is unchanged: four reports of one
Kalmar match that ideally merge, plus two articles that must be rejected.

## Do NOT change

- `pickSummary()` or any summarisation logic.
- RSS parsing, deduplication, relevance classification, Gemini synthesis, or
  production data.
- The `EXPECTED_DROPPED` constant (the evaluator deliberately passes no `known`).
- The claim-traceability rule, the fixture guard, or the single-request design.

## Tests

Add a small test file, or extend an existing one, that proves:

1. Every fixture article has a non-empty `summary`.
2. No fixture summary is identical to its own title.
3. Summaries are within a plausible length band for real RSS descriptions —
   assert a ceiling so a future edit cannot quietly turn the fixture into
   full-article text.
4. The evaluator still contains **exactly one** `await fetch(` targeting the
   Gemini endpoint, and still has no retry and no `synthesizeWithGemini`.

Run the full suite. Baseline is **317 passing**; your additions must pass and
nothing existing may break.

---

# Part 2 — Documentation closeout

Update `docs/ENHANCEMENTS.md`. The next session must be able to resume without
rediscovering tonight's work.

That file already has a `## Fresh-chat handoff statement` section (near line
1661) and an `## Outstanding items` section. Update in the established style
rather than inventing a new format, and place the new record where a reader
looking for tonight's state will actually find it.

## The record must state, clearly and without overclaiming

**Completed and verified**

- Prefilter false-negative fixed. Articles naming a current Häcken man but never
  saying "Häcken" were being discarded as "no Häcken relation". Committed as
  **`c69828e`**, pushed to `main`, 5 files, 317 tests passing.
- The fix reuses `classifyRelevance()` and the `KnownPersons` object that
  `run.ts` already builds. It was a wiring fix, not a new system.
- A **real pre-existing bug** was exposed and fixed in the same commit:
  `classifyRelevance` branch 3 (the known-person path) never applied the
  women/youth veto, contradicting the function's own documented contract.
  Branches 1 and 2 both applied it. The branch was unreachable in production
  only because the prefilter ignored known-person matching; wiring it made it
  reachable. The fix is strictly more conservative — it can only turn
  `CURRENT_HACKEN` into `UNRELATED`.
- Gemini evaluation fixture URL typo fixed (`premiar-bota` → `premiar-borta`),
  which had caused `t7` to 404 and left the primary men/women discrimination
  test running with no article text.
- A fixture guard added that reports `fixture-invalid` and exits non-zero
  **before** the Gemini request, so a stale fixture costs zero quota.

**The deliberate evaluation and its outcome**

- Exactly one deliberate Gemini evaluation was run: workflow
  `gemini-semantic-eval.yml`, run **`36357217641`**, on commit `c69828e`.
- It returned **HTTP 503** — `UNAVAILABLE` / *"This model is currently
  experiencing high demand."*
- **No retry was made. Exactly one Gemini request was spent.**
- Therefore **no semantic result was obtained.**

**Verified, and it is a fixture artefact**

- The fixture articles carried no `summary`, so `pickSummary()` always fell back
  to the title. The resulting "excerpt" baseline is an artefact of the test
  data, **not a production summary defect**.
- Production RSS descriptions are populated: `rss.ts` maps `<description>` into
  `summary`, and the real `bkhacken.se` feed supplies 57–152 character prose
  descriptions.
- Deterministic exact-duplicate handling is sound and was verified empirically:
  identical titles from two outlets merge into one multi-source event, and
  canonical-URL duplicates are dropped. Differently-worded reports of the same
  match correctly do **not** merge.

**Known limitation**

- Deterministically grouping differently-worded reports of one underlying story
  remains unsolved. This is the meaningful remaining Gemini use case and it is
  **deliberately not** being solved with rule-based clustering, because the
  ambiguous cases (pre-match vs post-match, interview vs match report, transfer
  vs match, shared players across unrelated stories, women's vs men's) would
  misfire and produce false merges.
- A related observation, **not a defect**: `rss.ts` sets `dedupeKey` to the
  article URL, which makes the title-key fallback in `buildNewsEvents` unreachable
  in production. Merging works regardless, because `dedupeNews` overwrites the
  key on an exact-title match. Fragile but not broken. Record it as an
  observation only.

**Open decision**

- **Gemini adoption is undecided.** No successful controlled semantic evaluation
  has ever been obtained. Do not describe Gemini as validated.

**Next step — state it exactly**

> Run one deliberate Gemini evaluation using the corrected, realistic fixture and
> inspect the result before deciding whether Gemini belongs in the production
> news flow. That run must remain a **one-request** evaluation with **no retry
> and no model fallback** unless separately authorised.

Also record that three consecutive manual full-size attempts returned 503
(12:44, 21:10, 23:00 on 2026-09-27), while the production nightly succeeded via
retry (`calls=2 events=3`, 503 on attempt 1, 200 on attempt 2). The open
question is whether capacity is the binding constraint, not architecture.

**Explicitly out of scope**

- Deterministic semantic clustering — deliberately declined.
- Production summary, RSS, dedup, relevance or Gemini-synthesis changes.
- `geminiRecheck.ts`, which still carries the same `premiar-bota` typo at
  line 40 and would 404 on `t7` if run.
- The failing `e2e/news.spec.ts` "2 källor" assertion, which predates tonight
  and reflects that multi-source events now occur.
- The weakened `discipline states never contradict the warning data` e2e test.
- Untracked `.github/prompts/` session files.

## Documentation discipline

Distinguish explicitly between **completed**, **verified**, **known
limitation**, **next step** and **explicitly out of scope**.

**Do not create a false sense of completion.** Do not write or imply that Gemini
has been validated semantically. It has not.

---

# Validation

Run before reporting, reading exit codes directly:

```bash
npx tsc -b; echo "tsc=$?"
npm run --silent lint; echo "lint=$?"
npx vitest run 2>&1 | tail -5
grep -c 'await fetch(' pipeline/src/geminiSemanticEval.ts   # must be 1
```

Also confirm no production file changed:

```bash
git status --porcelain
git --no-pager diff --stat
```

Expected changed paths: `pipeline/src/geminiSemanticEval.ts`, the new or
updated test file, and `docs/ENHANCEMENTS.md`. **Anything else, report before
touching it.**

Then commit and push, staging only those paths. Check divergence first; if
`HEAD..origin/main` is non-empty, **stop and report — do not rebase, do not
merge.**

---

# Scope discipline

This is a closeout pass, not another investigation. If you notice something
interesting outside this scope, **report it and do not fix it**, labelled:

> **Post-deployment finding — not fixed in this pass.**

---

# Final report, then stop

1. **Files changed.**
2. **Tests and gates**, with results and the test count before and after.
3. Confirmation that **zero Gemini requests** were spent in this pass.
4. Confirmation that **no production news behaviour was changed**, naming the
   files you did not touch.
5. **Documentation updated** — the section you edited and a one-line summary.
6. **Any remaining loose threads.**
7. **The exact recommended starting point for the next session**, in one or two
   sentences.

Then stop. Do not begin the next session's work.
