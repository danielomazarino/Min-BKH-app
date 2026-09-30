---
name: BKH — Unblock B-004 by writing the failing grouping test (no Gemini request)
description: B-004's blocker is mislabelled in the log. It is NOT capacity-blocked — the failing half of the fix (a fixture assertion that t1 must not group with t3-t6) can be written, committed, and made to fail WITHOUT any live Gemini call. Writes only that test. Does not edit SYSTEM_INSTRUCTION. Zero Gemini requests.
argument-hint: "Test-only. Writes the regression test that proves the false merge, then stops."
agent: agent
---

You are working in the **Min BKH-app** repository. This is a **test-only**
task. You will add one failing test and stop. You will not fix anything.

## Absolute constraints

- **Spend ZERO Gemini requests.** No `gemini:*` command, no workflow dispatch,
  no `npm run pipeline`, no external API call.
- **Do NOT edit `SYSTEM_INSTRUCTION` in `pipeline/src/gemini.ts`.** Read it, but
  do not touch it. Part 4 explains why this is still the rule even though the
  blocker label is being corrected.
- **Do NOT change any production behaviour.** No edits to `run.ts`, `rss.ts`,
  `dedupe.ts`, `newsEvents.ts`, `newsRelevance.ts`, `newsPrefilter.ts`,
  `classify.ts`, or anything under `app/`.
- **Do NOT write deterministic clustering.** It is out of scope and it is the
  wrong fix for this defect.
- **Do NOT re-enable Gemini** in any workflow. B-004 is unfixed.
- Do not touch B-003, B-005, E-005, or E-006–E-009.
- **The test you write MUST fail.** That is the deliverable, not a defect in
  your work. See Part 3.

## Progress reporting

**Post one short status update roughly every five minutes of working time, and
no more often.** Post it and keep working. Never stop to ask permission on a
routine step.

---

# Part 1 — Read the context

Read `docs/ENHANCEMENTS.md` — the **B-004** entry and the
**SUPERSEDED 2026-09-29** block under "OPEN DECISION — do not describe Gemini
as validated". Do not re-derive the root cause; it is established:

> `SYSTEM_INSTRUCTION` in `pipeline/src/gemini.ts:131` says *"Artiklar om samma
> match … hör till samma händelse, ÄVEN om rubrikerna skiljer sig helt."*

A pre-match **matchtrupp** announcement and a post-match **matchrapport** are
both "samma match", so this instruction **actively commands the false merge**.
Every false merge observed in production has exactly this shape.

**Root cause: known. Do not re-investigate. Do not spend requests on it.**

# Part 2 — Write the failing test

The offending pair is **already in the fixture**. Verified:

| id | publisher | when | what |
| --- | --- | --- | --- |
| `t1` | BK Häcken | 2026-09-19T08:00Z | *"BK Häcken åker till Kalmar – här är matchtruppen"* — **pre-match** |
| `t3` | BK Häcken | 2026-09-20T10:00Z | *"Gustav Lindgren: Det kändes väl väldigt bra…"* — **post-match** |
| `t4` | SVT Sport | 2026-09-20T12:00Z | *"Gustav Lindgren gör hattrick mot Kalmar"* |
| `t5` | Sportbladet | 2026-09-20T13:00Z | *"Häcken krossar Kalmar – hattrick av Lindgren"* |
| `t6` | FotbollDirekt | 2026-09-20T14:00Z | *"Hattrick från Lindgren – Häcken krossade Kalmar"* |

Add a test that asserts **`t1` must not share an event with any of
`t3`, `t4`, `t5`, `t6`.**

## Where to put it

`pipeline/src/geminiSemanticEval.fixture.test.ts` already exists and already
tests fixture integrity. Add a new `describe` block. Do not modify the
existing tests.

**Do NOT import `ARTICLES` from `geminiSemanticEval.ts`.** Verified constraint:
that module calls `main()` at module scope and `main()` performs the single
Gemini request then calls `process.exit`. Importing it from a test fires a real
request — which would violate the zero-request constraint in this task.

The existing test file already solves this correctly: it reads the source as
**text** (`readFileSync`) and extracts the `const ARTICLES ... = [ ... ];` block.
`ARTICLES` is **not** exported. Follow the pattern already in that file. This
is also why the file asserts the one-fetch guarantee by scanning source rather
than by calling anything.

Note what the existing tests cover: summaries non-empty, not repeating the
title, RSS-length bounds, t2/t4 lacking "Häcken", exactly one `fetch` in the
source. **None of them assert anything about grouping.** That is precisely the
gap that let the evaluation pass while production shipped the defect. Your new
test closes it.

## How to express the assertion

The grouping decision is made by Gemini at runtime, so this test cannot assert
Gemini's future output. Assert the **contract** instead — the invariant the
prompt must encode and the evaluation must later grade:

- `t1` is `category: "unknown"` / women's scope is irrelevant here; keep it
  about **pre-match versus post-match**.
- Assert that `t1`'s published date (19 Sep) is **before** `t3`–`t6` (20 Sep),
  i.e. they are a day apart and straddle the match — the structural fact that
  makes merging them a false merge rather than a judgement call.
- Assert the fixture therefore contains a pre-match/post-match pair, so the
  regression cannot be removed by editing the fixture away.

Name the test so the failure message states the defect in plain Swedish and
English terms. A future reader hitting a red test should immediately understand
that one card is standing in for two different stories.

## Make it honest

If you cannot assert the true invariant without a live call, **say so and stop
there** rather than writing a test that passes vacuously. A test that passes
because it asserts nothing is worse than no test — this repo has already been
burned by exactly that (`not.toContainText("Layouni")` passed on a blank
render). Report the limitation instead of hiding it.

# Part 3 — The test must FAIL

Run `npx vitest run pipeline/src/geminiSemanticEval.fixture.test.ts`.

**Expected outcome: your new test FAILS.** A passing test means you asserted
something Gemini's own prompt failure does not actually violate, or asserted
nothing at all.

If it passes, you have written a test that does not reproduce the defect. Go
back and tighten it. Do not "fix" it by weakening the assertion.

Report the failure output verbatim. This failing test is the deliverable and
the evidence that the false merge is reproducible from the fixture alone.

Then confirm the rest of the suite is unaffected:

```
npx vitest run
npx tsc -b
npm run lint
```

Expect 346 passed **plus your one new failing test**. Confirm the only failure
is yours.

# Part 4 — Correct the blocker label in the docs (small, and do it last)

`docs/ENHANCEMENTS.md` states B-004's fix is **"BLOCKED on capacity"** in more
than one place, and it contradicts its own `SUPERSEDED 2026-09-29` block. That
contradiction costs sessions time. The evidence, already in the log:

- Run `36493245277` established the secret is valid and the model is listed, so
  auth and model availability are eliminated as causes.
- Quota has never been observed on this key — no 429.
- The remaining 503s are transient sector-wide capacity, not a design or
  auth constraint.

**The accurate statement is: B-004's fix is blocked on a VALIDATION PATH, not
on capacity.** The prompt rewrite is straightforward; what is missing is a way
to confirm a rewritten prompt no longer merges `t1` into `t3`–`t6`.

That path exists. `.github/scripts/gemini-budget-check.sh` carries hard
guarantees, verified in its own header: the metadata call costs zero quota,
**at most ONE** `generateContent` call is ever made and only after auth
succeeded, and there is **no retry, no model fallback, and no loop**. The
`gemini-*.yml` workflows drive it. So a single validating call is affordable
today — the constraint was never the request budget.

Update every site that asserts a **capacity** blocker. Verified locations to
check — search for these, and do not limit yourself to them:

- L74: `fix BLOCKED on Gemini capacity`
- L1185: `FIX BLOCKED on capacity`
- L1215: `the API is capacity-blocked by a sector-wide incident`
- L2447: `the binding constraint is capacity, not quota, not auth, not model`

Say *validation-path blocked* rather than *capacity-blocked*. **But do not
rewrite the historical 503 records** — the run log, the sector-wide incident
note and the per-run outcome table are accurate history and must survive
intact. Change the *conclusion about the blocker*, not the *evidence*.

Also reconcile the internal contradiction: L2447 concludes capacity is the
binding constraint while the `SUPERSEDED 2026-09-29` block concludes the binding
constraint is correctness (B-004 itself). The superseded block is the later and
better-evidenced position. Bring L2447 into line and leave a one-line note
saying which position superseded which.

Keep the "do not re-enable Gemini" rule intact everywhere — it is still correct,
for the real reason: the defect is unfixed, not because the API is down.

# Part 5 — Report

State precisely, using "verified", "observed", "not yet tested":

- The failing test's name and its verbatim failure output.
- Which gate commands you ran and their actual output.
- That `SYSTEM_INSTRUCTION` is **unmodified** — state this explicitly.
- That zero Gemini requests were spent, and how you know.
- What Part 4 changed, quoting the before and after text.
- Anything you did **not** verify.

## Do not

- Do not edit `SYSTEM_INSTRUCTION`. Changing it blind is how it got broken.
  This task produces the test that will justify a future edit, nothing more.
- Do not make the test pass by weakening it.
- Do not re-enable Gemini.
- Do not write deterministic clustering.
- Do not claim B-004 is fixed. This task makes it **reproducible**, which is
  strictly less than fixed.
- Do not report a failing suite as a problem with your work. It is the
  intended deliverable.
