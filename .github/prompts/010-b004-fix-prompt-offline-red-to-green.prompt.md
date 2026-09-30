---
name: BKH — Harden the B-004 test, then rewrite SYSTEM_INSTRUCTION (still zero Gemini requests)
description: Turns the failing test green. First fixes a real defect I found in the test's own extraction logic (silent garbage on rename), then adds the missing pre/post-match rule to SYSTEM_INSTRUCTION. Zero Gemini requests. Does NOT re-enable Gemini and does NOT dispatch the eval — a live call is a separate, explicitly-authorised task.
argument-hint: "Red-to-green, offline. Harden the assertion, then fix the prompt. No Gemini, no deploy."
agent: agent
---

You are working in the **Min BKH-app** repository. The previous task made B-004's
false merge **reproducible**. This task makes the prompt **correct** — offline.

The failing test is the specification. Your job is to make it pass **honestly**,
then prove the fix is real rather than cosmetic.

## Absolute constraints

- **Spend ZERO Gemini requests.** No `gemini:*` command, no workflow dispatch of
  any kind, no `npm run pipeline`, no external API call. **Including no
  dispatching `gemini-semantic-eval.yml`** — that is the *next* task, and it
  needs explicit human authorisation.
- **Do NOT re-enable Gemini** in `data-update.yml` or anywhere else.
- **Do NOT commit `public/data/app.json`.** Do not regenerate it.
- **Do NOT add deterministic clustering.** Out of scope, and the wrong fix.
- Do not touch B-003, B-005, E-005, E-006–E-009.
- **The only production file you may edit is `pipeline/src/gemini.ts`**, and
  within it **only the `SYSTEM_INSTRUCTION` template literal.**

## Progress reporting

**Post one short status update roughly every five minutes of working time, and
no more often.** Post it and keep working. Never stop to ask permission on a
routine step.

---

# Part 1 — Fix a real defect in the test's extraction

Before touching the prompt, the test itself has a bug. Verified by probe.

## The defect

The test locates `SYSTEM_INSTRUCTION` with `indexOf` and no failure check:

```ts
const head = "const SYSTEM_INSTRUCTION = `";
const start = GEMINI_SRC.indexOf(head);
const from = start + head.length;
const end = GEMINI_SRC.indexOf("`;", from);
return GEMINI_SRC.slice(from, end);
```

If `SYSTEM_INSTRUCTION` is ever **renamed**, `indexOf` returns `-1`, `from`
becomes `19`, and the function silently returns text starting from the wrong
offset. Probed result:

```
renamed const -> start -1 -> extracted: " = `matchtrupp matchrapport"
```

The test then evaluates its regexes against **garbage**. It still fails, so it
*looks* correct — but for the wrong reason. A test that cannot distinguish
"prompt is wrong" from "my extraction is broken" is not a specification.

## What to do

Assert the extraction succeeded, and fail loudly with a clear message when it
did not. `start < 0` and `end <= from` must both be treated as extraction
failure, not silently tolerated.

Note the second probe result too: a trailing space before the closing backtick
(`\` ` ;`) leaves the delimiter in the extracted text. Decide deliberately
whether to trim, and say which you chose.

## Also widen the vocabulary, deliberately

The current patterns are narrow:

```ts
const PRE_MATCH  = /\b(matchtrupp|förhands|förberedelse)\b|\bföre\s+match/i;
const POST_MATCH = /\b(matchrapport|matchreferat|resultatet)\b|\befter\s+match/i;
```

A correct rule phrased as *"information före avspark"* or *"matchen som inte
ännu spelats"* would satisfy the **intent** but fail the **regex**, leaving a
red test on correct code. That is a tripwire, not a contract.

Broaden both patterns to cover the natural phrasings a Swedish-language fix
would use. Keep them tight enough that they cannot match the current prompt —
verify that by running the test and confirming it still fails before you edit
the prompt. **That ordering matters:** widen the regexes first, confirm red,
then fix the prompt.

## Part 1 gate

```
npx vitest run pipeline/src/geminiSemanticEval.fixture.test.ts
```

**Must still fail**, now for the *right* reason: the prompt lacks the rule, and
the extraction demonstrably works. If your hardening made it pass, you have
widened the patterns too far — that is a bug in your change, not progress.

# Part 2 — Rewrite the offending rule

## The defect, precisely

`SYSTEM_INSTRUCTION` in `pipeline/src/gemini.ts` currently contains:

> *"Artiklar om samma match, samma resultat, samma transfer eller samma skada
> hör till samma händelse, ÄVEN om rubrikerna skiljer sig helt."*

A pre-match **matchtrupp** announcement and a post-match **matchrapport** are
both "samma match", so this sentence **actively commands the false merge**. The
existing counter-example (*"matchresultat och kontraktsförlängning"*) does not
cover the pre/post boundary.

## Requirements for your replacement

1. **Separate the match boundary explicitly.** Material from *before* the match
   (matchtrupp, förhandsprogram, besöksinformation, matchtröpehelg) and material
   from *after* it (matchrapport, resultat, referat) are **separate events**,
   even when they describe the same fixture and even within the same week.

2. **Preserve the intent that was correct.** Differently-worded reports of the
   same *post-match* outcome — t3, t4, t5, t6 — genuinely ARE one event and must
   still merge. Do not over-correct into "never merge same-match articles", which
   would trade a false merge for four near-duplicate cards and regress B-003
   further. This is the trap in this task.

3. **Write it in Swedish**, matching the surrounding instruction's register and
   vocabulary.

4. **Do not restructure the prompt.** Add or amend the minimum needed. Every
   other rule in `SYSTEM_INSTRUCTION` is deliberate and load-bearing.

## Show the reasoning

Before editing, state in one or two sentences why you believe the offline test
going green means the prompt is *more* correct — and be explicit that it does
**not** mean the grouping is fixed. It means the prompt now states the rule. Only
a live call proves Gemini complies.

# Part 3 — Gates

```
npx vitest run
npx tsc -b
npm run lint
```

Expected: `Tests  349 passed (349)` — the previously failing B-004 test is now
green and nothing else moved. Total stays 349; this is a state change, not a
count change.

Confirm zero failures. If anything else fails, stop and report it.

# Part 4 — Record what is now owed

Update the B-004 fix plan in `docs/ENHANCEMENTS.md`. Steps 1 and 2 are already
marked DONE; step 3 ("only then change the prompt") is now complete **offline**.

Mark the state honestly:

- The prompt now contains the pre/post separation rule.
- The offline assertion is green.
- **This is NOT a validated fix.** No Gemini call has been made, so it is
  unproven that Gemini *complies*. The prompt can state a rule and the model can
  ignore it — that has happened in this repo before and is the entire subject of
  B-004.
- The owed action is **one** live evaluation via `gemini-semantic-eval.yml`
  (`workflow_dispatch`, one `fetch`, no retry, no fallback, verified to write no
  files). It requires explicit human authorisation and is **not** part of this
  task.
- B-004 stays **OPEN**. Do not describe it as fixed, resolved, or validated.
- Keep "do not re-enable Gemini" intact — the defect is now *suspected* fixed,
  not proven, and production must not run unvalidated LLM output. `AGENTS.md` is
  explicit that a successful generation is not proof of correctness.

# Part 5 — Report

State precisely, using "verified", "observed", "not yet tested":

- The before/after text of the rule you changed, quoted.
- Your reasoning for keeping t3–t6 merging while separating t1, in one or two
  sentences.
- The extraction hardening: what you asserted, and the probe output proving the
  old version returned garbage on rename.
- Actual output of all three gate commands.
- That `SYSTEM_INSTRUCTION` is the **only** production file changed — show
  `git diff --name-only`.
- That zero Gemini requests were spent and no workflow was dispatched.
- What is **not** verified — state the unproven compliance plainly.

## Do not

- Do not dispatch `gemini-semantic-eval.yml` or any workflow. One request needs
  explicit authorisation that this prompt does not grant.
- Do not re-enable Gemini in the nightly.
- Do not commit `public/data/app.json`.
- Do not weaken the test to make it pass. If the prompt cannot be fixed without
  weakening the assertion, stop and report that instead.
- Do not over-correct into "never merge same-match reports" — that breaks t3–t6
  and regresses B-003.
- Do not claim B-004 is fixed. It is **provisionally addressed, unvalidated**.
- Do not treat a green suite as evidence the grouping works. It is evidence the
  prompt mentions the rule.
