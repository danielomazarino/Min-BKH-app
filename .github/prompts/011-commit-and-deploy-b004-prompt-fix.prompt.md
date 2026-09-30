---
name: BKH — Commit and ship the B-004 prompt fix (deploy is a provable no-op)
description: Commits the B-004 prompt fix plus the test hardening and doc corrections, then pushes. The deploy is USER-INVISIBLE by construction — gemini.ts is pipeline-only and never enters the client bundle — so this is verified by bundle-hash equality, not merely by a green run. Zero Gemini requests.
argument-hint: "Commit + push, with byte-level proof the deploy changes nothing users can see."
agent: agent
---

You are working in the **Min BKH-app** repository. This is a **commit-and-verify**
task. The engineering is already done and reviewed. Your job is to land it
cleanly and prove the deploy did what was intended — which is *almost nothing*.

## Absolute constraints

- **Spend ZERO Gemini requests.** No `gemini:*` command, no workflow dispatch,
  no `npm run pipeline`, no external API call.
- **Do NOT run `gemini-semantic-eval.yml`.** B-004 still needs one authorised
  live evaluation, and this prompt does **not** grant that authorisation.
- **Do NOT re-enable Gemini** in `data-update.yml` or any workflow.
- **Do NOT edit `SYSTEM_INSTRUCTION` again.** It is done and reviewed. Any
  further prompt tuning without a live eval is unmeasurable.
- **Do NOT commit `public/data/app.json`.** Do not regenerate it.
- Do not touch B-003, B-005, E-005, E-006–E-009.
- Do not run `git reset`, `git revert`, or force-push. This is a forward-only
  commit.

## Progress reporting

**Post one short status update roughly every five minutes of working time, and
no more often.** Post it and keep working. Never stop to ask permission on a
routine step.

---

# Part 1 — Confirm what you are about to ship

Three tracked files are modified. Verify that is still exactly true:

```
git status --porcelain --untracked-files=no
git --no-pager diff --stat
```

Expected, and nothing else:

| file | change |
| --- | --- |
| `pipeline/src/gemini.ts` | **+2 lines**, inside the `SYSTEM_INSTRUCTION` literal only |
| `pipeline/src/geminiSemanticEval.fixture.test.ts` | +172, test hardening |
| `docs/ENHANCEMENTS.md` | B-004 blocker relabelled, status corrected |

**If `gemini.ts` shows any change beyond the two added lines, stop and report.**
The constraint was that only the prompt literal changes — no restructuring, no
reformatting of surrounding rules.

`.github/prompts/` also shows a rename (`push-e005-…` → `008-…`). That was a
deliberate numbering convention applied outside this task. Leave it. If you
commit the renames, keep them as renames — do not "restore" the old filenames.

# Part 2 — Gates, re-run by you

Do not trust the numbers in the docs or in any prior report.

```
npx vitest run
npx tsc -b
npm run lint
npm run pipeline:validate
```

Expected: **`Tests  349 passed (349)`**, zero failures — the B-004 test that was
deliberately red is now green and the total is unchanged at 349. Then `tsc`
clean, `lint` clean, `OK: app.json`.

**A red suite here is a regression, not the expected state.** The previous task
left one test red *on purpose*; that task is complete and the suite must now be
fully green. If anything fails, stop and report — do not commit a red suite.

# Part 3 — Commit

One commit. It contains a test, a prompt fix, and the documentation that
records both, and the documentation is part of the change, not a follow-up.

```
git add pipeline/src/gemini.ts pipeline/src/geminiSemanticEval.fixture.test.ts docs/ENHANCEMENTS.md
git commit
```

Write a message that states what changed and — more importantly — what is
**still unproven**:

- The prompt now separates pre-match from post-match material, and explicitly
  preserves merging for reports of the same concluded outcome.
- The offline assertion is green.
- **B-004 is NOT fixed.** No Gemini call has been made, so it is unproven that
  the model *complies*. A prompt can state a rule and the model can ignore it;
  that is the entire subject of B-004.
- Gemini remains disabled in the nightly.
- One authorised live eval is owed.

Do not write "fixes B-004" anywhere in the commit message.

# Part 4 — Push, and verify by bytes

```
git push
git rev-parse HEAD
git --no-pager log --oneline -1 origin/main
```

The push triggers `deploy.yml` (`on: push: branches: [main]`). Wait for the run
to conclude:

```
gh run list --workflow=deploy.yml --limit 3 --json databaseId,headSha,status,conclusion,url
gh run watch <RUN_ID> --exit-status
```

## The important part — what the deploy should NOT change

This deploy is **user-invisible by construction**, and that is a claim worth
proving rather than assuming:

- `pipeline/src/gemini.ts` is **pipeline-only**. It runs in Node during the data
  pipeline. It is never bundled into the client — verified: the string
  `"SYSTEM_INSTRUCTION"` does not occur in `dist/assets/index-*.js`.
- Nothing under `app/` changed, so no component, style or route changes.
- Nothing under `public/` changed, so `app.json` is byte-identical.

Therefore the correct post-deploy observation is that the **bundle hash does not
change**:

```
curl -s https://danielomazarino.github.io/Min-BKH-app/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'
curl -s https://danielomazarino.github.io/Min-BKH-app/data/app.json | sha256sum
```

Expected: bundle still `assets/index-B9Si6Jzq.js`, and `app.json` still
`c8e247cb067cb33268062ad0e3987221d6215495709af5e4d32034460f730e5b`.

**An unchanged bundle is the success condition, not a failure.** Vite derives
content-hashed filenames from content, so identical client input must produce an
identical filename. A *different* bundle hash would mean something under `app/`
or `public/` changed without being intended — investigate before concluding
anything.

Note this is the inverse of the earlier E-005 deploy, where the bundle hash
changing was the proof that new code shipped. Here the bundle hash must **not**
change, and `app.json` cannot distinguish success from staleness at all. Say so
in your report rather than presenting a hash match as proof of a fresh deploy.

# Part 5 — Report

State precisely, using "verified", "observed", "not yet tested":

- The commit SHA and message.
- All four gate commands with their actual output.
- Confirmation that `gemini.ts` changed by exactly two added lines and nothing
  else.
- The deploy run URL and its conclusion.
- The bundle hash and `app.json` hash **before and after**, and the explicit
  statement that the bundle was expected to be unchanged.
- That zero Gemini requests were spent and no workflow was dispatched by you.
- **That B-004 remains OPEN and UNVALIDATED**, and that one authorised live
  evaluation is still owed.

## Do not

- Do not run `gemini-semantic-eval.yml` or any `workflow_dispatch`. Authorisation
  for the single eval is not granted here.
- Do not re-enable Gemini.
- Do not commit a red suite.
- Do not commit `public/data/app.json`.
- Do not claim B-004 is fixed, resolved, or validated.
- Do not treat the unchanged bundle hash as a failed deploy. It is the expected
  result, and reasoning about it is part of your job.
- Do not use `git reset` or force-push.
