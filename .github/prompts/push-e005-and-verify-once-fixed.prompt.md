---
name: BKH — Push E-005, then verify it once the data has actually regenerated
description: Pushes the merged E-005 discipline fix and its data-driven e2e tests, then sets up the production verification for the 2026-10-01 nightly. Carries one documented correction: the "self-corrects on the next nightly" claim was wrong, and the fix is not observable until the night AFTER the push. Zero Gemini requests.
argument-hint: "Push-only, then arm the verification. No pipeline run, no Gemini, no data regeneration."
agent: agent
---

You are working in the **Min BKH-app** repository. This task is mostly
**sequencing and verification discipline**, not new code. The interesting
engineering already happened; the risk now is verifying it at the wrong moment
and drawing a false conclusion.

Read `docs/ENHANCEMENTS.md` — specifically the **START HERE** block — before
starting. It has been corrected this session and its claims are verified.

## Absolute constraints

- **Spend ZERO Gemini requests.** No `gemini:*` command, no workflow dispatch of
  any `gemini-*` workflow, no `npm run pipeline`, no external API call.
- **Do NOT run `npm run pipeline`.** It is the 12-request path and it
  regenerates production data. Not now, not "just to check".
- **Do NOT hand-edit `public/data/app.json`.** Never. It is generated. Editing
  it by hand to make Layouni appear `departed` would forge the exact evidence
  this task exists to gather.
- **Do not edit any source file under `app/` or `pipeline/`.** The fix is
  written, reviewed and committed. There is nothing left to implement.
- Do not re-enable Gemini in any workflow. B-004 is unfixed.
- Do not touch B-003, B-004, or E-006–E-009.
- **Do not push before running the gates yourself.** Do not trust the numbers
  in the docs; re-run and read your own output.

## Progress reporting

**Post one short status update roughly every five minutes of working time, and
no more often.** Post it and keep working. Never stop to ask permission on a
routine step.

---

# Part 1 — Commit and push what is already verified

## State you should confirm before doing anything

```
git status
git --no-pager log --oneline -4
git --no-pager log --oneline origin/main..HEAD
```

Expected: a clean tree, with three commits unpushed on top of `origin/main`:

| commit | what |
| --- | --- |
| `ed8d597` | the E-005 discipline fix |
| `eb6f406` | merge of `origin/main` into local `main` |
| `be57a04` | data-driven e2e tests + corrected docs |

**If the tree is not clean, or the unpushed set is not those three commits,
stop and report.** Do not improvise a different push.

## Why the push is safe — and why `reset` is not

An earlier revision of the docs warned that pushing would regress data
freshness by a day. That warning is **retired**. It was true when local and
origin had diverged; the merge resolved it.

Verify the three hashes agree before you push:

```
sha256sum public/data/app.json
git show origin/main:public/data/app.json | sha256sum
```

Both must be `c8e247cb067cb332…`. A third independent check, which is the one
that actually matters:

```
curl -s https://danielomazarino.github.io/Min-BKH-app/data/app.json | sha256sum
```

All three identical means the push ships no older file. `git reset` is still
the wrong move, but now for the opposite reason: it would discard `ed8d597`,
the fix itself.

## Gates — re-run all four, read the output yourself

```
npx vitest run
npx tsc -b
npm run lint
npm run pipeline:validate
npx playwright test e2e/brief.spec.ts
```

Expected: 346 passed / 16 files, clean tsc, clean lint, `OK: app.json`,
24 passed / 2 skipped.

**The 2 Playwright skips are pre-existing and unrelated** — dashboard tests
that skip when the last-result row has no button to open a sheet. Do not
"fix" them and do not report them as a failure.

One expected noisy line: `geminiResearch.test.ts` logs a live Gemini 429
(`quota exceeded`). That is the test exercising its quota-exhausted path. It is
harmless, it spends no quota, and the suite still passes. Do not try to
suppress it.

## Push

```
git push
```

Pushing `main` triggers `deploy.yml` (`on: push: branches: [main]`), so the
push **is** the deploy. Note the deploy is *not* pinned here — it builds
`GITHUB_SHA`. That is correct for a code-only push.

## Verify the deploy by bytes, not by run status

A green Actions run proves nothing about what the origin now returns. Wait for
the run to finish, then:

```
curl -s https://danielomazarino.github.io/Min-BKH-app/data/app.json -o /tmp/served.json -w "http=%{http_code}\n"
sha256sum /tmp/served.json
python3 -c "
import json
d=json.load(open('/tmp/served.json'))
print('generatedAt', d['freshness']['generatedAt'])
print('ledger rows', len(d['discipline']))
from collections import Counter
print(Counter(r['status'] for r in d['discipline']))
print('Layouni', [(r['status'], r['warningCount']) for r in d['discipline'] if 'Layouni' in r['playerName']])
"
```

Expect `generatedAt` = `2026-09-30T03:46:56.126Z`, 18 rows, and Layouni still
`('at_risk', 2)`.

**That unchanged result is the correct outcome for this push.** See Part 2. Do
not treat it as a failed deploy.

---

# Part 2 — The timing trap, and the verification for 2026-10-01

## The correction

The docs previously stated that E-005 "self-corrects on the next nightly". **That
was wrong**, and the reason is worth understanding.

The 2026-09-30 nightly (`5e72fa0`) ran at `03:46:56Z`. It checked out
`origin/main` — which at that time did **not** contain `ed8d597`, because the
fix was unpushed. Proof:

```
git merge-base --is-ancestor ed8d597 5e72fa0   # -> NO, exits 1
```

So the nightly executed **pre-fix code** and emitted Layouni as `at_risk`
exactly as before. Nothing about that run was anomalous. It was a correct run of
the code that was actually deployed.

## The consequence

`app.json` is regenerated **only** by the nightly pipeline. Pushing `ed8d597`
changes what the *next* nightly will compute. It does **not** retroactively
change any data already generated or served.

Therefore:

| moment | Layouni in served data |
| --- | --- |
| now (after this push) | `at_risk` — expected, **not a bug** |
| after the **2026-10-01** nightly | `departed` — the fix, observable |

**Do not curl before the 2026-10-01 nightly and conclude E-005 failed.** That
is the single most likely wrong conclusion here, and it would send someone to
"fix" correct code.

## What to do about it

Record the push time and the commit SHA, then stop. Leave the verification for
after the 2026-10-01 nightly runs (~03:45 UTC). Do not dispatch the nightly by
hand — `npm run pipeline` and manual runs both violate the constraints above,
and an off-cycle regeneration would destroy the very lineage evidence being
gathered.

When the verification session happens, the nightly's own guard is the primary
evidence: `data-update.yml` fails the run if the deployed bytes do not match the
committed bytes. If that run is green, the served file is the regenerated one.

Then confirm the domain outcome specifically:

- Layouni's `status` is `departed`, not `at_risk`.
- `warningCount` is still `2`.
- `relevantWarnings` still lists his two real matchIds (6529848, 6529897).
- The ledger still holds **18** entries — rows are never deleted by E-005,
  because the cards are real and dropping them would falsify the season record.
- The other three `at_risk` players are unaffected: only players *outside* the
  current squad change status.

**History preserved, only classification moved.** If a row disappears, that is
a defect — report it, do not accept it.

---

# Part 3 — Report

State precisely, using "verified", "observed", "not yet tested". Do not present
an assumption as a fact. Specifically:

- Which gates you ran, and their actual output.
- The three `app.json` hashes, and whether they agreed.
- The deploy run URL, and the result of the post-deploy curl.
- That Layouni remains `at_risk` **and that this is expected**, with the
  `merge-base` evidence for why.
- That E-005's data-level effect is **not yet observable** and is owed after the
  2026-10-01 nightly. This is the key honest caveat.
- Anything you did not verify.

## Do not

- Do not re-enable Gemini. B-004 is unfixed and a capacity blip is exactly how
  the bad 2026-09-27 data reached production.
- Do not edit `SYSTEM_INSTRUCTION` in `gemini.ts` until a Gemini request can
  actually succeed. The current wording *causes* the false merge; changing it
  blind makes it worse.
- Do not hand-edit `public/data/app.json` to force a `departed` row.
- Do not delete ledger rows for departed players.
- Do not treat the 2 Playwright skips as a failure.
- Do not report E-005 as "fixed in production". Report it as *pushed, pending
  the next data regeneration*.
