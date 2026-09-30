---
description: Fix the deploy gap so nightly data updates actually reach production
---

# Task: fix the deploy gap — nightly data updates never reach production

## The confirmed root cause

**`data-update.yml` pushes with the default `GITHUB_TOKEN`. GitHub does not
trigger new workflow runs from `GITHUB_TOKEN` pushes (its recursion guard).
`deploy.yml` is `on: push: branches: [main]`, so it never sees the nightly
bot's data commit. Every nightly regenerates `public/data/app.json`, commits
it, and it is never built or published.**

Production has therefore been serving whatever data existed at the last *human*
deploy. Verified: no deploy run has ever corresponded to a bot data commit
(`2bf0661`, `a58ae68`, `7dbbafc`, `c653ecb` → 0 deploy runs each). Last
successful deploy was `7457c23` (2026-09-28 00:05).

**User-visible effect.** The live news feed shows 3 Gemini-synthesised groups,
two of which wrongly merge unrelated stories. The correct data already exists in
`origin/main` as commit `c653ecb` — 6 events, all `rss-description`, all
single-source. It has simply never been deployed.

## What NOT to change — this is the important part

**Do not touch the news grouping code.** It is correct. Do not edit:

- `pipeline/src/newsEvents.ts`
- `pipeline/src/dedupe.ts`
- `pipeline/src/gemini.ts`
- `pipeline/src/newsPrefilter.ts`
- `pipeline/src/rss.ts`
- anything under `app/`

This was verified empirically: running the real `dedupeNews` + `buildNewsEvents`
over the currently-deployed articles produces **6 correct single-source events**.
The deterministic path is not capable of producing the bad groups. Editing it
would be fixing a non-bug and would risk regressing legitimate duplicate
handling.

**Do not make any Gemini API call.** No `npm run gemini:status`, no
`gemini:eval`, no `gemini:recheck`, no `gemini:size-probe`, no
`npm run pipeline`. Gemini's 503 is a separate, documented question. This fix
must cost **zero** Gemini requests.

**Do not regenerate `public/data/app.json`.** The correct data is already
committed at `c653ecb`. Do not run the pipeline to produce it. Do not hand-edit
the data file.

## Scope of the change

Confine changes to:

- `.github/workflows/data-update.yml` (and/or `deploy.yml`)
- a new test if you can express the guarantee in a testable form
- `docs/ENHANCEMENTS.md` (status line only)

### Primary fix

Make the nightly publish the data it generates. Pick **one** approach and
justify it briefly:

- **(a)** Add build + `deploy-pages` steps to `data-update.yml` that run after a
  successful data commit, guarded so they only run when the commit actually
  happened.
- **(b)** Have `data-update.yml` explicitly dispatch `deploy.yml` via
  `workflow_dispatch` (a dispatch is a separate event and is not blocked by the
  `GITHUB_TOKEN` recursion guard), and add `workflow_dispatch` inputs if needed
  to pass the ref.
- **(c)** Restructure so deploy is driven by `workflow_run` completion of the
  data workflow.

Consider carefully and state your reasoning:

- **Recursion safety.** Whatever you choose must not create a deploy→data→deploy
  loop, and must not deploy when the data did not change.
- **Auth.** `deploy.yml` needs `pages: write` and `id-token: write`. If you
  reuse it via dispatch, verify the permissions and environment are available on
  the dispatched run. If you inline the deploy, you must grant them.
- **Ordering.** The deploy must publish the data from the commit that was just
  pushed, not a stale artifact.
- **Failure behaviour.** If the Gemini stage fails inside the pipeline but the
  pipeline still writes valid data (the deterministic fallback), that valid data
  **should** be deployed. The current bug blocks good data exactly as much as it
  blocks bad data.

### Required regression guard

A silent infrastructure regression is how this went unnoticed. Add the cheapest
guard that would have caught it. At minimum, one of:

- a check that fails when a data commit exists on `main` with no corresponding
  successful deploy;
- a post-deploy smoke step that fetches the deployed `data/app.json` and asserts
  it matches the committed one (e.g. compare a checksum or
  `newsEvents.length`).

If you judge that neither fits this repo's conventions, say so and explain what
you did instead. Do not skip the guard silently.

### Verification you must perform

- `npm run typecheck` — must pass.
- `npm test` — must pass. Report the count before and after; you are not expected
  to change any test, so a change in count must be explained.
- `npm run lint` — must pass.
- `npm run build` — must succeed.
- `npm run pipeline:validate` — must pass against the **existing committed**
  `public/data/app.json`. Do not regenerate the data first.

**Production-data verification.** After the workflow change, confirm the
mechanism works. Prefer a `workflow_dispatch` dry run of the changed workflow
and inspect the run log. Then confirm what is actually served:

```
curl -s https://danielomazarino.github.io/Min-BKH-app/data/app.json
```

Expected: **6 news events, every `summaryMethod` equal to `rss-description`,
every event single-source.** Not 3 groups with `gemini-synthesis`.

Note: a successful deploy does not mean a *browser* shows it immediately. The
service worker caches `/data/*.json` with `NetworkFirst`, so a hard reload is
needed. Verify the **served file** with curl, not with a screenshot.

**If you cannot complete the production verification in this session** — for
example because it requires a real nightly window — say so explicitly and state
exactly what remains unverified. Do not claim the fix works because the build
passed.

## Explicitly out of scope

- Grouping / dedupe / event-construction logic (correct; see above).
- The Gemini system prompt and B-004 (a real but separate latent defect).
- The `t7` fixture URL, which is a hard 404 in both ASCII and `ä` spellings.
- Any refactor of `data-update.yml`'s pipeline stage.
- Unrelated doc edits, dependency changes, or formatting churn.
- Committing `.github/prompts/*.prompt.md` — those are intentionally untracked
  local files.

## Report back

State plainly:

1. **Root cause you found**, and whether it matched the one stated above. If you
   found a different cause, stop and report that instead of proceeding.
2. **What you changed**, file by file, with the reasoning for your approach
   choice.
3. **What you deliberately did NOT change**, and why.
4. **Verification actually performed** — which commands, what the results were.
   Use "verified" and "observed" precisely. Distinguish clearly between
   *the workflow file is correct* and *production now serves the right data*.
5. **What remains unverified.**
6. **Test results** — before/after counts.
7. **Anything you found but did not fix**, especially if you notice signs that
   production has been serving stale data for other sections (squad, discipline,
   former players), since this bug is not news-specific.

Do not report success unless the deployed `data/app.json` shows 6 events. If it
does not, report what you observed instead.
