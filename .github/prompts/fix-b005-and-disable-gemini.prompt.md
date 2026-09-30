---
description: Fix the nightly deploy gap and disable Gemini in the production pipeline
---

# Task: fix the nightly deploy gap (B-005), then disable Gemini (Option A)

Two changes, **in this order**. The order is not cosmetic — see "Why this order"
below. Stop and report when both are done. Do not start a second pass.

---

## PART 0 — Context you must not re-derive

The production news feed has been serving **incorrect data since 2026-09-27**.
The root cause is already established and proven. Do not re-investigate it.

**The bad data** was produced by a successful Gemini run (`36292290265`,
`gemini ok=true calls=2 events=3`, commit `7dbbafc`). It produced 3 events, two
of which wrongly merged unrelated stories:

| Bad card | Wrongly merged |
|---|---|
| Gustav Lindgren 5–0 Kalmar | post-match interview **+ pre-match "matchtruppen"** |
| Lindberg 1–1 Mjällby | post-match report **+ besöksinformation + matchtruppen** |
| TV4 Play streaming | 1 article (this one was fine) |

All three carry `summaryMethod: "gemini-synthesis"`.

**Two independent defects are being addressed, and you must not conflate them:**

- **B-005 (this task):** nightly data is committed but never deployed.
- **B-004 (NOT this task):** the Gemini prompt wrongly groups pre-match service
  articles into post-match result events. **Unresolved and deliberately deferred.**

**The deterministic pipeline is NOT broken.** Running the real `dedupeNews` +
`buildNewsEvents` over the affected articles produces 6 correct single-source
events. The grouping code is correct. Do not "fix" it.

### Why this order matters

Fixing B-005 alone would publish bad Gemini output. Disabling Gemini alone would
produce correct data that **still never reaches users** — because nothing deploys
it. **Neither change alone is sufficient.** Do B-005 first, verify deployment
works, then apply Option A. If you apply Option A first you will have no way to
observe that the deployment fix actually worked.

---

## PART 1 — Fix B-005: the nightly deployment gap

### The confirmed root cause

`data-update.yml` commits and pushes using the **default `GITHUB_TOKEN`**.
GitHub Actions deliberately **does not trigger new workflow runs from pushes
made with `GITHUB_TOKEN`** (its recursion guard, to prevent infinite workflow
loops). `deploy.yml` is `on: push: branches: [main]`, so it **never observes the
nightly bot's data commit**.

**Evidence (already verified — you do not need to re-run it):**

- No deploy run has ever corresponded to a bot data commit. Checked `2bf0661`,
  `a58ae68`, `7dbbafc`, `c653ecb` → 0 deploy runs each.
- Last successful deploy: `7457c23` (2026-09-28 00:05).
- Newer data commit `c653ecb` (2026-09-28 03:51) has **no deploy run**.

### What you must do

1. **Read `.github/workflows/data-update.yml` and `.github/workflows/deploy.yml`
   in full before changing anything.** Note that `data-update.yml` currently
   declares `permissions: contents: write` and that `deploy.yml` declares
   `permissions: contents: read` plus `pages: write` and `id-token: write`.
2. Choose the **simplest reliable** mechanism. In order of preference:
   - **(a)** Add `workflow_dispatch` inputs to `deploy.yml` (if not present) and
     have `data-update.yml` dispatch it after a successful data commit. A
     `workflow_dispatch` is a distinct event and is **not** blocked by the
     `GITHUB_TOKEN` recursion guard.
   - **(b)** Add build + `deploy-pages` steps directly to `data-update.yml`,
     running **only** when the data commit actually happened, with
     `pages: write` and `id-token: write` granted.
3. **You must explain, in your report, why your chosen mechanism does not
   re-trigger itself** and why it cannot produce an unbounded workflow loop.
   Address specifically: what stops `deploy.yml` from pushing anything, and what
   stops a deploy from causing a data update that causes a deploy.
4. **Preserve the existing GitHub Pages deployment mechanism** (`configure-pages`
   → `upload-pages-artifact` → `deploy-pages`, and the `github-pages`
   environment). Do not replace it with a different publishing method.
5. **Ordinary source-code pushes to `main` must still deploy normally.** A
   human pushing a feature commit must trigger `deploy.yml` exactly as before.
   State explicitly how you verified this is still true.
6. **The deployment must publish the data from the commit that was just pushed.**
   Ensure the checkout/artifact cannot pick up a stale copy — note that
   `actions/checkout@v4` in a *separate* workflow run starts from the default
   branch HEAD, so confirm the ordering actually works rather than assuming it.

### Required guard against silent recurrence

Add the **smallest practical guard** that would have caught this. It must detect
or report the case where: **the data job successfully committed new production
data, but the deployment did not run or did not complete.**

Acceptable forms (pick one, keep it small — do not build a monitoring system):

- A final step in `data-update.yml` that asserts the deploy was triggered and
  completed, failing loudly if not.
- A post-deploy smoke step that fetches the deployed `data/app.json` and asserts
  it matches the just-committed data (compare a checksum, or
  `newsEvents.length`).

A guard that only ever passes, or that cannot fail, is not acceptable. If you
judge neither form fits the existing architecture, say so and explain what you
did instead — do not skip it silently.

---

## PART 2 — Apply Option A: disable Gemini in the nightly pipeline

**Configuration-only. Remove the `GEMINI_API_KEY` environment-variable
injection from `.github/workflows/data-update.yml`.**

That single deletion is the whole change. The mechanism is already built in:

- `pipeline/src/gemini.ts:370-377` — `synthesizeWithGemini` short-circuits on
  `!process.env.GEMINI_API_KEY`, returning `result: null, calls: 0`.
- `pipeline/src/run.ts:411-416` — the pipeline then takes the deterministic
  branch **unconditionally**.

There is **no `GEMINI_ENABLED` flag** in this codebase, and you must not add one.

### Temporary invariant

```
DETERMINISTIC NEWS = production-authoritative path
GEMINI             = disabled from the production nightly pipeline
```

This makes bad Gemini synthesis **structurally impossible** in the nightly run —
not filtered, not suppressed after the fact, but never invoked.

### You must NOT

- Add `GEMINI_ENABLED` or any other feature flag.
- Modify `run.ts`, `gemini.ts`, `buildEventsFromGemini`, the Gemini prompt, or
  the Gemini response schema.
- Modify `newsEvents.ts`, `dedupe.ts`, `newsPrefilter.ts`, `newsRelevance.ts`,
  or `rss.ts`.
- Add a new Gemini fallback implementation.
- Modify or regenerate `public/data/app.json`.
- Change `app/`.

Update the now-stale comment above the removed `GEMINI_API_KEY` line (or delete
it). Do not leave a comment claiming Gemini is active when it is not.

### Secrets hygiene

Other workflows (`gemini-*.yml`) legitimately still need `GEMINI_API_KEY` for
**manual, deliberate** research runs. **Do not delete the repository secret.**
Only remove its injection from `data-update.yml`. Removing the secret entirely
would break the research tooling and is out of scope.

---

## PART 3 — Do not fix B-004 in this pass

B-004 is the confirmed Gemini semantic-grouping defect. It is real, it is
unresolved, and it is **deliberately deferred**.

Do **not**: improve Gemini grouping · tune the Gemini prompt · alter semantic
clustering · alter source selection · change the Gemini schema · "make Gemini
safer" · add Gemini evaluation assertions · modify Gemini evaluation fixtures.

The purpose of this pass is to **close the production risk** while B-004 stays
open. If disabling Gemini seems to make B-004 irrelevant, it does not — B-004
still exists and must be fixed before Gemini is re-enabled.

---

## PART 4 — Testing and validation

Run the existing gates:

- `npm run typecheck`
- `npm run lint`
- `npm test` — report the count before and after. You are not expected to
  change any test, so **any change in count must be explained**.
- `npm run pipeline:validate` — against the **existing committed**
  `public/data/app.json`. **Do not run `npm run pipeline`** and do not
  regenerate data.
- `npm run build` — must succeed.
- Any workflow/config validation available (`actionlint` if present, otherwise
  state that you validated the YAML by inspection and by the run succeeding).

**Add only the regression tests necessary for B-005 and its guard.** Workflow
triggering is not unit-testable in vitest; if you cannot express the guard as a
test, say so and rely on the production verification instead.

**Spend zero Gemini requests.** Do not run `gemini:status`, `gemini:eval`,
`gemini:recheck`, `gemini:size-probe`. Do not dispatch any Gemini workflow.

---

## PART 5 — Production verification (the part that actually matters)

**A green Actions run does not prove production is correct.** Verify the served
file.

```bash
curl -s https://danielomazarino.github.io/Min-BKH-app/data/app.json
```

### Expected baseline

The correct deterministic output is committed at **`c653ecb`**, and it is
already on `origin/main` (the last data commit). It contains:

- **6** news events
- every `summaryMethod` equal to **`rss-description`**
- every event **single-source** (`sources.length === 1`)
- sha256 prefix of that file: `c7ac177e8c0c3e47`

Expected event titles:

1. Gustav Lindgren: "Det kändes väldigt bra från den första minuten"
2. BK Häcken åker till Kalmar – här är matchtruppen
3. Julius Lindbergs kvitteringsmål gav delad pott mot Mjällby
4. Stötta BK Häcken när du streamar Allsvenskan på TV4 Play
5. Fredagsmatch inleder matchtröjehelgen – besöksinformation inför Mjällby
6. Matchtruppen inför Mjällby på Nordic Wellness Arena

### You must confirm

- [ ] The **three bad Gemini-synthesis groups are gone** from the served file.
- [ ] The **6 deterministic events** are present.
- [ ] **No event** has `summaryMethod` of `gemini-synthesis` or
      `gemini-synthesis-fallback`.
- [ ] Every event is single-source.
- [ ] The served file is **genuinely the newly deployed version** — not a cached
      copy. Compare the sha256 prefix against the value above, and re-fetch after
      a moment if the first fetch looks unchanged.

### Do not verify via a browser

The service worker caches `/data/*.json` with **`NetworkFirst`**
(`vite.config.ts:44-58`), so a browser may show a stale cached payload and a
screenshot proves nothing. **Verify the served bytes with curl.** If you do open
a browser to sanity-check the app, a hard reload is required and the curl result
is still the authoritative check.

Also confirm the app actually consumes that file — the served `app.json` is
fetched at runtime by the built app, so verifying the file plus the app booting
without error is sufficient. Do not rebuild `dist/` to make this pass.

**If production verification is not possible in your session** (e.g. no deploy
window available), say so explicitly and state exactly what remains unverified.
**Do not claim the fix works because the build passed.** Distinguish clearly
between *"the workflow file is correct"* and *"production now serves the right
data"*.

---

## PART 6 — Documentation

Update `docs/ENHANCEMENTS.md` **only** as needed to close this incident. Record:

- **B-005** root cause (the `GITHUB_TOKEN` recursion guard), the fix, the guard.
- **Option A**: Gemini disabled from the production nightly pipeline, as
  configuration-only.
- **Deterministic news is now the temporary production-authoritative path.**
- **B-004 remains unresolved and deliberately out of scope.**
- The production verification result.
- The exact commit SHA(s) implementing the change.

Do not rewrite unrelated enhancement history. Use the existing status keys
(`OPEN` / `DONE` / `BLOCKED`). Where something remains unfixed, use the exact
wording:

> **Post-deployment finding — not fixed in this pass.**

---

## Scope control

Change **only** what is needed for: (A) B-005 nightly deployment, (B) the
minimal silent-deployment guard, (C) the Gemini env removal.

Do not: fix B-004 · improve news relevance · change deterministic grouping ·
improve Gemini · run Gemini evaluations · regenerate unrelated data · refactor
the pipeline · change the UI · touch unrelated backlog items.

If you find an unrelated defect, do **not** fix it. Record it in your report as:

> **Post-deployment finding — not fixed in this pass.**

One existing item you may notice and should **not** act on: the `t7` fixture URL
in `geminiRecheck.ts` / `geminiSemanticEval.ts` is a hard 404 in both the ASCII
and `ä` spellings. Known, tracked, out of scope.

---

## Final report — cover all eleven points

1. **Files changed** — list them all.
2. **Exact changes made** — per file, and your reasoning for choosing that
   deployment mechanism over the alternatives.
3. **Tests/gates passed** — with before/after unit-test counts.
4. **Deployment workflow behavior** — what now happens, step by step, when the
   nightly commits data.
5. **How the recursion problem was avoided** — the explicit mechanism, and why
   no deploy→data→deploy loop is possible.
6. **How the silent-deployment guard works** — and how it fails when it should.
7. **Confirmation that Gemini was not called** — state it plainly.
8. **Production `app.json` verification** — the actual curl output, event count,
   `summaryMethod` values, and the sha256 comparison.
9. **Confirmation the three bad Gemini groups are no longer served.**
10. **B-004 status** — explicitly: still unresolved, not fixed.
11. **Remaining loose threads** — anything incomplete, unverified, or that you
    found but deliberately did not fix.

If your investigation reveals a root cause **different** from the one stated
here, stop and report that instead of proceeding. Do not invent a fix for a
problem you have not reproduced.

**Stop after completing this scope and report. Do not begin a second pass.**
