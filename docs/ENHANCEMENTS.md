# Min BKH-app — Enhancement Log

**What this is:** every known improvement, defect and open question for the
supporters' app, written in plain language. What the item is, what a supporter
sees, why it matters, and what it would take to close it.

**Read this file when:** you want to know what is broken, what is planned, or
what is still unproven. You do **not** need to read it to build or deploy.

> **Full technical history is preserved verbatim** in
> `docs/archive/ENHANCEMENTS-history-2026-09-30.md` — all 3,279 original lines,
> byte-identical, including superseded conclusions and run-by-run evidence.
>
> Sections that used to live here and now live **only in the archive**:
> `START HERE` (superseded state blocks), `SUPERSEDED 2026-09-29`,
> `OPEN DECISION — do not describe Gemini as validated`, the `L-0xx` lessons,
> the `P-0xx` product decisions, the `N-001` post-pass findings, and the
> per-run Gemini evidence tables. Search the archive for them by heading.
>
> Current state is summarised at the top of this file and in **Engineering
> status** at the bottom. If a prompt or note tells you to read a section that
> is not here, it is in the archive.

Status keys: `OPEN` · `IN PROGRESS` · `DONE` · `BLOCKED` · `NEEDS DECISION`

---

## Current state — 2026-10-05 (03:20 CEST / 01:20 UTC)

> This snapshot can lag reality by hours. Before relying on it, check the live
> state yourself: `git log -1` for the current commit, `curl -s
> https://danielomazarino.github.io/Min-BKH-app/data/app.json | sha256sum` for
> the served data. Nothing below goes stale *on its own* — only this header's
> "as of" date does.

| | |
| --- | --- |
| App | Live at `danielomazarino.github.io/Min-BKH-app` |
| Current commit | `git log -1` — deliberately not hardcoded, because a hash here is stale the moment the next commit lands |
| Tests | **440 unit tests passing** (20 files) and **367 end-to-end tests passing across Chromium AND WebKit** — both suites verified green 2026-10-05, and CI run `37264656883` concluded **success** on the deployed commit `808866f`. End-to-end runs on two engines only since WebKit was installed; before that it had never executed (see the CI section below) |
| Data last generated | **2026-10-04 05:10 UTC** — served bytes verified to match the data commit (`1fe721c…`) |
| Gemini | **Free tier, hard cap 20 requests/UTC day** (measured from a 429 body, 2026-10-01). **Measured over 35 probe runs to 2026-10-04: reachable ~48% of the time, but the chat probe that resembles real work succeeded 0/15 — never once.** Still disabled in the nightly (the key is deliberately not injected). B-004 unvalidated. |
| OpenRouter | **Transport VERIFIED WORKING 2026-10-04.** Key added; ping **1/1 = 200**, chat probe **1/1 = 200** on the payload Gemini failed **0/15** on. Free model, **cost 0 credits**, key reports **1000 req/day**. **Quality still unvalidated** — see **B-008** |
| OpenRouter | **Runs every night now, MEASUREMENT ONLY — its answer is discarded and never reaches the app.** Transport verified: 3 attempts ever, **1 succeeded** (21s, 23,636 B), 2 refused by the shared free pool (HTTP 429) while only 4/1000 of *our* budget was used. Fixed fixture evaluation passed all 5 checks. **Real-news reliability at 03:30 is exactly what the nightly run is now measuring** — see the OpenRouter section below |
| Next event | **03:30 UTC** nightly — one run, now including the OpenRouter measurement |

### The Gemini availability probe was STOPPED on 2026-10-04

Its schedule had a self-imposed deadline ("remove on Sunday 2026-10-05"); it was
met one day early. **Nothing was deleted** — both probe scripts, the workflow and
the repository secret all remain, and the schedule is one uncommented line. To
take a single measurement by hand:

```bash
gh workflow run gemini-overnight-availability.yml   # exactly ONE request
```

That is also the supported way to run the decisive experiment in **B-004**. If
you later go to a **paid** Gemini tier, or want another go at the free one, the
restore steps are written out at the top of
`.github/workflows/gemini-overnight-availability.yml`.

**What the 35 runs actually showed** (1 request per firing, never retried):

| Probe | Input | Result |
| --- | --- | --- |
| availability ping | 144 B | **10 / 21 succeeded (48%)** |
| chat question | 586 B | **0 / 15 succeeded (0%)** |

Gemini is **not down**. But the probe that resembles real work has never once
worked, so the experiment could not answer the question it existed to answer —
and 11 requests a day cannot answer it either.

> **One caveat that must not be forgotten.** The two probes fired at *disjoint
> hours*: chat only at 05/09/13/17/21 UTC, ping only at 03/07/11/15/19/23. So
> "chat always fails" and "those hours always fail" were **indistinguishable**.
> That was a design flaw, not a finding. The five ways the two payloads differ
> are input size, output tokens (2048 vs 1024), temperature (0.5 vs 0.1),
> `responseMimeType`/`response_format` JSON mode, and the system message. Which
> of those matters is **still untested**.

### The previous overnight checkpoint (2026-10-01 to 10-04) — now historical

### Historical: the previous overnight checkpoint

Five probes fire at **02:00, 04:00, 06:00, 08:00, 10:00 UTC**. Each run makes
**2 requests** (availability at production settings + one small chat question),
so **10 requests across the night**. No retries, nothing written.

| Pattern across the 10 samples | Conclusion |
| --- | --- |
| All 503 | Sustained outage, not a blip. Stop treating Gemini as available. |
| All 200 | The afternoon was transient. B-004 can finally be validated. |
| Mixed | A capacity window opens at night — the original hypothesis. |

**Limits to hold onto:** GitHub Actions cron can be delayed up to ~15 minutes,
and scheduled workflows are *skipped entirely* under high platform load. **An
absent run is not evidence.** Always check `gh run list --workflow=
gemini-overnight-availability.yml` for the runs that actually happened.

**The 03:30 nightly is the first live run of the Göteborgs-Posten feed**, and
the first run using the new per-source diagnostics. Its log should now contain a
block like:

```
    BK Häcken         fetched  23  kept   6  dropped  17  (no Häcken relation 17)
    Göteborgs-Posten  fetched  45  kept   0  dropped  45  (...)  <-- ZERO CONTRIBUTED
    news ingest by source: 8 sources, N fetched, M kept — 1 source(s) returned items but contributed NOTHING: ...
```

If Gemini is still 503 at 03:30, the nightly uses the **deterministic
fallback**. That is the expected state, not a new fault — and it means GP's
first exercise happens *without* the Gemini path, so we still will not learn
how it behaves when Gemini works. That question stays open either way.

Commit hashes **are** used further down this file, but only for past events —
*"fixed in `c73b820`"*, *"run `36747767583` returned 503"*. Those are permanent
anchors to a specific change or a specific run, not live values, so they do not
rot. If a hash here ever appears as a *current* value rather than a past one,
treat it as suspect and re-check with `git log`.

---

## The three things that matter right now

> **New since this list was written:** the app now SHOWS what the per-source
> diagnostics measure. Settings → Nyhetskällor lists each feed with how many
> articles it actually contributed ("3 av 20 behölls"), an info button
> explaining in plain Swedish what the source does and what breaks without it,
> and a table in the technical section showing those counts across the last
> eight nightly runs. This makes the six-zero-contribution finding below
> visible to anyone, not only to whoever reads the nightly log. See
> **B-006** for the details.

> **Also new:** the player sheet now shows a photo, a dated career timeline and
> national-team caps for any player Wikidata records them for — read from
> claims the app already fetches, at zero extra requests. The OpenRouter route
> for this was evaluated and deliberately rejected; see **"Player enrichment —
> why not the AI"** below.

**1. A player who has left the club still appears in the "watch out for cards" list.**
The fix is written, tested and deployed, but the app's data is only rewritten by
the overnight job. Until that job runs tonight, supporters will see a stale
entry. This is **expected and self-correcting** — not a new bug. Do not "fix" it
by hand-editing the data file; that would forge the very evidence we need.

**2. News stories never combine sources.**
Every one of the 6 current news cards is a **single link**. When BK Häcken beat
Kalmar 5–0, five different outlets reported it, but a supporter scrolling the
news layer sees five separate cards instead of one card saying "Häcken won 5–0
— as reported by BK Häcken, SVT, Sportbladet, FotbollDirekt". The app already
supports the combined display (source labels, one written summary). The data
pipeline simply never produces it. See **B-003**.

**3. A layout problem on iPhone was reported but could not be reproduced.**
A supporter reported the player search field shifting the page sideways on an
iPhone 13. Automated testing on a desktop browser could **not** reproduce it. That
does **not** mean it is fixed — it means the only place it was ever seen has not
been checked. Only the person holding the phone can confirm. See **N-001b**.

---

## Closed since the last update (2026-10-03 → 2026-10-04)

All three were found by **testing on a real iPhone**, not by automated tests. Each
one is invisible in desktop Chromium, which is the central lesson of this round.

### E-015 · The menu was too small for a thumb, and the indicator poked out of the bar

**Status:** FIXED · **Deployed** · **Affects:** the one piece of navigation every
supporter uses

**What the phone showed.** The five destinations were hard to hit with a thumb,
and — clearest at the right-most tab, **Spelare** — the selected glass indicator
visibly stuck out past the menu's rounded border.

**Two separate causes, and neither was the gesture code.**

1. **Too small.** Each tab was about 66×58px on a 390px phone. That is above the
   44px accessibility minimum, but it is not a comfortable thumb target. The bar
   is now ~358×78px with 71px-wide tabs: the width roughly doubled in usable
   terms while the height was deliberately kept moderate, since a taller bar was
   also reported as too big.
2. **The indicator protruded.** The tab positions were computed across
   `offsetWidth`, which is the **border** box, so the last position overshot the
   usable area by twice the border width and the indicator's corners reached
   outside the bar's rounded edge. Clipping the overflow would have hidden the
   symptom and left the geometry wrong, so the positions are now measured on the
   padding box and inset from the edges by the smallest distance that still
   reads as a gap.

**Measured result, all five tabs:** the indicator protrudes by 0.00px on every
edge and sits within 0.10px of its tab's centre.

**One further correction, from the same screenshot.** The indicator's corners did
not follow the bar's curve — it read as a lozenge inside a differently-shaped
frame. It is now a **concentric band**: its corner radius equals the bar's radius
minus the inset, so both curves share a centre and the gap is identical on every
side.

### B-007 · The news list showed the same date twice

**Status:** FIXED · **Deployed**

**What supporters saw.** In the news archive a day heading was immediately
followed by the same date on its first row:

```
2 SEP.
2 sep.   Officiellt: BK Häcken lånar ut Sanders Ngabo
```

**Why it happened.** For anything older than two weeks the day heading fell back
to the same date format the row already prints, so the date appeared twice, in
two different casings. Measured over 60 days: it happened on **47 of them**.

**The fix keeps the useful part.** Recent days keep their relative heading
("I dag", "I går", "För 3 dagar sedan", "Förra veckan") because that tells a
supporter how current something is, which a bare date does not. Older days drop
the heading and the row's own date carries it — so each day now shows its date
**once**, never zero.

---

## B-008 · Trying OpenRouter's free tier instead of Gemini

**Status:** tooling committed · **transport VERIFIED WORKING** · **quality still
unvalidated** · blocked on nothing

### The result: OpenRouter works where Gemini did not

A key was added on 2026-10-04 and both probes were run — **two requests total**.

| Probe | Gemini | OpenRouter |
| --- | --- | --- |
| availability ping | 10 / 21 (48%) | **1 / 1 — HTTP 200** |
| chat question (same payload) | **0 / 15 (0%)** | **1 / 1 — HTTP 200** |

The chat probe returned 1170 characters, parsed **5 of 5 items**, every summary
between 114 and 128 characters (inside the 200 limit), `finish_reason: stop`,
provider `ModelRun`, and **cost: 0 credits**.

**What this establishes.** The identical payload that failed 15 times out of 15
on Gemini succeeded first time here. So Gemini's 0/15 was **provider-specific,
not a property of the task** — which retires one of the two explanations for
B-004, and weakens the pure time-of-day theory (both probes ran within two
minutes of each other).

**What it does NOT establish.** A 200 is not a quality verdict. B-004's real
risk is **false merges** of pre-match articles into post-match result events,
which reached production once. Nothing here has tested grouping accuracy on real
news, and OpenRouter's own FAQ describes free models as *"usually not suitable
for production use"* — which is fine for one request a night, and wrong for
anything a supporter sees.

### Account facts, measured

- Free requests today: **used 0, limit 1000, remaining 1000**
- `is_free_tier: false` — it has never bought credits, yet reports the higher
  tier. **So do not derive the ceiling from `is_free_tier`; read
  `free_model_daily_requests`.**
- Per-key cap: 50 credits (the `$50` ceiling set in the OpenRouter UI — a cap,
  not a charge; free models cost nothing)
- Credits used, today and total: **0**

**Why this is worth trying.** Gemini's news grouping (B-004) has never produced a
single usable answer. The stopping probe was not the whole story, though: over 35
runs the tiny availability ping succeeded **10 times out of 21**, so Gemini is
genuinely reachable about half the time. It is the *bigger* request that has never
worked — 0 out of 15. That is worth one more attempt somewhere else before anyone
pays for a tier.

**What is already built**, mirroring the Gemini probes so the two can be compared
without re-reading two methodologies:

- `openrouter-availability-sample.sh` — the 144-byte ping
- `openrouter-chat-probe.sh` — the same chat question, with all five shape
  differences from the ping deliberately preserved, so the result is comparable
  to Gemini's 0/15
- `openrouter-key-info.sh` — reads the key's own daily counter (**0 requests**)
- `openrouter-availability.yml` — runs them, **by hand only**, one request per
  run

**What is blocked.** Nothing. The key was added on 2026-10-04 and both probes
have since run successfully — see the result above. To take further measurements
by hand:

```bash
gh workflow run openrouter-availability.yml            # one ping
gh workflow run openrouter-availability.yml -f probe=2 # the chat question
```

**What it costs.** Free models are capped at **20 requests/minute**. The daily
ceiling depends on the account: the documented figures are 50/day below 10
credits purchased and 1000/day above it. **This key reports 1000/day** — and note
it reports that while `is_free_tier` is `false`, so do not derive the ceiling
from that flag. One request per manual run is a trivial fraction of it. Two
things worth knowing before trusting a failure:

- OpenRouter documents that free variants cost nothing, and that **new accounts
  receive a small free allowance** — so **you should not have to pay to test
  this**. A **402** means billing, not quota, and the two are easy to confuse.
  The docs specifically tie 402 on `:free` models to a **negative** balance; a
  zero balance may be fine. If free requests start failing, read the response
  body before topping up.
- **503 means "no provider available"**, which is a different failure from
  Gemini's "model experiencing high demand". Free models often have very few
  providers behind them.

**The honest limit on what this can prove.** The workflow alternates probes by UTC
hour, exactly as the Gemini one did — so OpenRouter would inherit the *same*
time-of-day confound. Comparing its chat result against Gemini's 0/15 is
therefore **not a clean comparison**, and must not be reported as one. Removing
that confound means running both probes in a single firing, which doubles the
cost; that is a deliberate decision, not something to slip in silently.

**If it does work,** the next step is still B-004: run the real semantic
evaluation and get an actual quality verdict. A 200 would only prove the transport
works — and this repo has already been bitten by a 200 that meant nothing.

---

## B-009 · A test that failed on its own, at a specific moment

**Status:** FIXED · **Was blocking every deploy**

**What happened.** One unit test had been failing since roughly 15:00 UTC on
2026-10-04:

```
AssertionError: expected undefined to be 3
  pipeline/src/data.test.ts > fixture normalization > picks next upcoming and last finished
```

Because both CI and the deploy workflow run the test suite, **this one stale
assertion was failing every push** — including the push that only intended to
change documentation and CI config.

**Why it failed.** `pickNextAndLast` decides what is "upcoming" by comparing each
match against the real clock:

```ts
const now = new Date().toISOString();
const upcoming = sortMatches(matches.filter((m) => m.date > now && ...));
```

The test supplied a hardcoded fixture date of `2026-10-04T15:00:00Z` and asserted
it would be treated as an upcoming match. At 15:00 UTC on 2026-10-04 that date
became **the past**, so the function correctly stopped calling it upcoming and
`next` became `undefined`.

**Nothing was wrong with the production code.** The function did the right thing.
The test was asserting something about the calendar, and the calendar moved.

**The lesson worth keeping.** A test that hardcodes a date and then asks a
function to compare it to `Date.now()` is not testing behaviour — it is setting a
timer. It will pass, sit green for months, and then fail on its own with no code
change at all, which reads exactly like a regression and sends you hunting in the
wrong place. The same applies to any future timestamp, any expiry assertion, and
any "recent" or "upcoming" window.

**The fix.** Both fixture dates are now derived from the clock at call time
(±3 hours), so the relationship under test — one match in the future, one in the
past — holds whenever the suite runs. No production code was touched.

---

## Player enrichment — why not the AI

**Status:** SHIPPED 2026-10-05 · **Affects:** the player detail sheet (Spelare)

**The request.** "Build the functionality to increase the information about
players that we have been discussing early on but never built. Use the thought
that we can use the OpenRouter API to fetch more information."

**What was actually built.** The player sheet now shows, whenever Wikidata
records it: a **photo** (P18, as a width-limited Commons thumbnail), the
**position** (P413, as a Swedish label), a **dated career timeline** (every P54
club period with years, appearances and goals from the statement's own
qualifiers, newest first), and **national-team caps** listed apart from clubs.

**Why not OpenRouter.** The idea was evaluated seriously, then rejected on
measured facts — not on principle:

1. **The data already exists in a request we already make.** `wbgetentities`
   with `props=claims` returns P54 qualifiers on every statement that carries
   them. Measured on real Häcken players: 10/10 of Bjärsmyr's stints carry
   dates, 9/10 carry apps and goals. The enrichment costs **zero extra network
   requests** and zero LLM calls.
2. **OpenRouter's web search is not free.** The `:free:online` suffix routes
   through Exa at **$0.007 per request** — a cost the free tier does not waive.
   The nightly measurement run is one request per night precisely because the
   budget is finite; per-player research on every sheet open would be a
   different order of spend.
3. **A generated answer cannot be audited the way a claim can.** This app's
   rule is that every fact is traceable to a source. A structured Wikidata
   claim IS the source. An LLM summary of a career would be a second-hand
   account of the same data, with a failure mode (plausible fabrication) this
   project has spent weeks designing against — see **B-004**.
4. **The free-model pool is unreliable at the moment of use.** Measured: 2 of 3
   nightly attempts hit upstream 429s. A sheet that sometimes enriches and
   sometimes doesn't is worse than one that always shows what the source
   actually records.

**Where OpenRouter still makes sense.** News-event grouping (B-008), where the
input is unstructured article text that no structured source covers, and where
one request per night is the whole budget. The boundary is: **structured data
from its source; unstructured text to the model.**

**The two bugs the tests caught before release.** Both are the reason the
verification discipline exists:

- The position label was never requested: `collectLabelQids` collected
  citizenship and club Q-IDs but not P413's, so the sheet rendered the raw
  string "Q280658" where "anfallare" belongs. **Caught by e2e, not by unit
  tests** — the unit fixture supplied the label directly, hiding the gap.
- The national-team label fallback used `\blandslag\b`, which matches nothing:
  Swedish compounds the word ("herr**landslag**", "dam**landslag**"), so no
  real label contains it as a standalone word. Caught by a unit test written
  against a real label.

**The third bug only live verification caught.** With "Landslag" having its own
section, the old "Klubbar" list still showed national teams as clubs —
"Husqvarna FF · Sveriges U17-herrlandslag i fotboll · …" read as a
contradiction. The sheet's club list is now derived from the career timeline,
so the two views cannot disagree. No unit or e2e test asserted the club list's
content against a player with national teams; the check was made by reading the
deployed sheet. Committed as `4ea134a`.

---

## OpenRouter now runs every night — measuring only, changing nothing

**Status:** ARMED · **Supporter-visible effect: NONE, by design** ·
**Decided 2026-10-05**

### What changed, in one sentence

Once per night at 03:30 UTC, the pipeline now also sends the day's articles to
OpenRouter, records what came back and how long it took, and then **throws the
answer away**. The news you read is built exactly as before.

### Why this is not the same as switching it on

This is the distinction that matters, so it is worth being precise:

| | Tonight's change | Actually switching it on |
|---|---|---|
| Requests per night | 1 | 1 |
| Where the answer goes | **nowhere** | your news feed |
| If the answer is wrong | nothing happens | supporters read wrong news |
| If it fails (429/503) | logged, pipeline continues | logged, pipeline continues |
| Retries | none, ever | none, ever |

The app builds its news from the deterministic path in **both** cases. Look at
the call site in `pipeline/src/run.ts`: the OpenRouter result is logged and
never assigned to `newsEvents`.

### So what does a week of this buy?

Three things that cannot be learned from a single manual test:

1. **Is it actually available at 03:30?** Free OpenRouter models sit in a pool
   shared with every other user. Our own budget use was 4 of 1000 requests when
   we were turned away, so any 429 is the shared pool, not us. A week of
   nightly attempts answers "does this work reliably enough to depend on?"
2. **How long does it take?** A service that answers in 40 seconds is a different
   proposition from one that answers in 4.
3. **Does the answer hold up on real news?** The one evaluation that passed did
   so on a fixed 8-article fixture. Nightly real news is the harder test.

### How to switch off

Remove the `OPENROUTER_API_KEY` repository secret. That is the whole procedure —
with the key absent the stage is skipped, and it is recorded as *skipped* rather
than silently vanishing. There is no schedule to cancel and no code to revert.

### What you will see in the app

Under the cog wheel → *Teknisk information och proveniens*, the OpenRouter row
will show a third status word, **Mäter** (amber), which is neither the green
*Påslaget* nor the grey *Ej påslaget*. It carries a one-line explanation that its
answer is discarded. Showing it green would tell you your news comes from this
provider. It does not.

### What is still NOT proven

- **Whether the nightly call succeeds.** See the table above: the first two
  attempts were refused by the shared pool. A later attempt reached the
  provider and was then refused for the same reason. This is exactly the
  unreliability the nightly exists to measure.
- That its output is right on real news. The fixture evaluation passed all five
  checks; nightly real news is a different and harder test, and this is the run
  that will tell us.
- Cost. `0` in the log means *the provider reported it free*; blank means *nobody
  told us*. Those two are never conflated.

### The first night already earned its cost

On its very first run the measurement found a bug that three manual evaluations
had missed:

```
OpenRouter HTTP 400: grammar does not compile: xgrammar StructuralTag
compilation failed
```

The cause was ours, not OpenRouter's. We were sending Gemini's schema, which
uses **uppercase** JSON-Schema type names (`"OBJECT"`, `"ARRAY"`). That is
correct for Gemini. But xgrammar — the engine behind OpenRouter's
`response_format: json_schema` — does not accept that dialect, and rejected the
request **before it ever reached the model**.

The reason three manual tests missed it: the working evaluation had its own
hand-written *lowercase* copy of the same schema. The contract had been
duplicated, and the copies had already drifted. Duplicated contracts between two
providers being compared is precisely how a comparison stops meaning anything.

So the contract now lives in one place, in two dialects, and a test walks the
OpenRouter schema and fails on any uppercase type name at any depth. After the
fix the same request returned **HTTP 429 rate-limited upstream** — a completely
different failure, and proof that it now passes validation and reaches the
provider.

**A measurement run that finds a bug on night one has already paid for itself.**

---

## Why CI was red, and what it was actually telling us

**Status:** FIXED · **Found 2026-10-05 · Both causes reproduce locally**

This one is worth reading in full, because the cause was not the one I claimed.

### Cause 1 — WebKit was never running at all (21 of the failures)

`playwright.config.ts` declares **two** browser projects: `chromium` and
`webkit`. The CI job installed only one:

```yaml
- name: Install Playwright browsers
  run: npx playwright install --with-deps chromium     # <-- webkit missing
```

So all 21 WebKit tests failed with:

```
browserType.launch: Executable doesn't exist at
  /home/runner/.cache/ms-playwright/webkit-2359/pw_run.sh
```

**That is not a test failure. It is a missing browser.** The WebKit assertions
never executed, so the suite had been reporting red while testing *nothing* on
the engine closest to real iOS Safari — the engine this app's touch navigation
depends on most. Now both are installed.

### Cause 2 — my own explanation was wrong

I previously attributed the red CI to tests being "sensitive to running in
parallel". **That was a hypothesis I never tested, and it was wrong.** The 24
failures split cleanly into the 21 environment failures above plus 3 genuine
Chromium failures that pass in isolation, i.e. timing, not parallelism.

I should have read the actual failure text before explaining it. The error said
"Executable doesn't exist" in plain sight.

### What was hiding behind the missing browser

Installing WebKit exposed a second layer: **10 WebKit touch tests failed for a
real, interesting reason** — and every one of them was a *harness* limitation,
not an app defect:

`newCDPSession` exists only in Chromium. WebKit cannot receive real injected
touch, so those tests fell back to synthetic `PointerEvent`s. Two consequences,
both now handled honestly:

- Three tests asserted that the browser fires `pointercancel` on a steep
  diagonal gesture. Synthetic events **bypass native gesture recognition
  entirely**, so no cancel is ever delivered and the assertion was really
  asserting "the harness failed to simulate the browser". They now assert only
  what is engine-independent, and say plainly why.
- One test, `fabnav-swipe`, moved a **fixed 48px** and expected the page to
  change. Measured tab pitch on a 390px screen is **~71px**, so 48px released
  the indicator *inside* the dead zone around the midpoint — and the app
  correctly read that as "a nudged thumb" and kept the current tab. **The app
  was right; the test was wrong.** It had only ever passed in Chromium by
  coincidence of layout. The gesture is now sized from the measured geometry,
  the same discipline `navIndicatorDrag.ts` already used.

  This is the clearest example in this project of a passing test that was
  measuring its own assumption rather than the product.

### The honest limit

A green WebKit run is evidence about **our logic**, not about iOS. Synthetic
events never touch WebKit's native gesture arbitration — the layer that decides
scroll-versus-drag and raises the link callout on a real phone. Only a real
iPhone verifies the gesture itself. That remains open.

### The recurring lesson: a wait that asserts instead of waits

The failures above were "fixed" several times each, and the early attempts were
**worse than the symptom**. That is worth recording, because it is easy to
repeat.

The honest bugs were real — a test sampling a moving target, a test racing a
render. Both tempt you to add a wait. But a wait has three failure modes:

| | Problem | Example |
|---|---|---|
| too short | still races | the original flakes |
| **too strict** | now asserts a duration the test has no business knowing | "the sheet stopped within 120ms" — failed on **all four** viewports, because the animation is simply longer than that |
| too narrow | waits for the wrong state | waiting for a result row in tests that *deliberately* produce none — broke two previously-passing tests |

The fix that worked was always the same idea: **stop guessing, and ask the thing
that already knows.**

- The sheet runs a named CSS animation, `sheet-in`, so the test waits for its
  `animationend`. No constant, no polling, and it cannot be wrong on a slow
  machine.
- The search page renders `data-testid="searching"` with `aria-busy` **while a
  query is in flight**, so the test waits for *that* to clear.

Both earlier attempts at the search wait tried to enumerate what the answer
might be — a hit, an empty state, a too-short query, an ambiguous one, a rate
limit, a transport failure. Each time I missed one and broke a different test,
including the two most important in the file. **Enumerating outcomes is the
wrong shape of question.** Asking "is this still pending?" has no such failure
mode.

A `waitForTimeout(N)` in a test is an admission of not knowing when the app is
ready. It is sometimes fine. It should never be load-bearing.

### And the one that was not a test bug at all

After all of that, a **different** test failed on each run. That pattern was the
real diagnosis: these were not flaky assertions but correct tests running out
of wall clock.

Playwright defaults to roughly half the CPU count, and the suite runs the whole
spec set for **two** browser projects. On a two-core runner that is real
oversubscription. The 45-second per-test budget had been sized back when only
Chromium ran, and never fit once both engines executed in parallel.

Fixed at the harness level rather than per test: budget raised to 90s, workers
capped at 2 so both engines stay covered without thrashing.

**The lesson I should have applied many attempts earlier:** when a *different*
test fails each run, stop fixing tests. That is the signature of an environment
problem, and no number of individual corrections will clear it.

---

## Open items, in plain language

### E-010 · The menu bar could not be dragged — it had nowhere to go

**Status:** FIXED · **Affects:** the one piece of navigation every supporter
uses · **Found 2026-10-03 · Root cause measured, not guessed**

**What supporters reported.** The bottom menu could be tapped but not dragged.

**The cause was a single CSS line, not the gesture code.** `.fabnav` was
declared `width: min(100% - 32px, 440px)` — that is the **full** width between
the two 16px margins. Measured in Chromium at three phone widths:

| viewport | bar width | horizontal travel |
|---------:|----------:|------------------:|
| 320px | 288px | **0px** |
| 390px | 358px | **0px** |
| 430px | 398px | **0px** |

A control with zero available travel cannot be moved, however correct the
pointer handling is. The gesture code was never given a chance to fail; there
was simply nowhere for the bar to go.

**Why it looked intentional.** The file header stated the bar was modelled on
the iOS WhatsApp tab bar and "does NOT move with the finger", and the CSS said
"no Liquid Glass". That was a deliberate prior decision — but it meant the
dragging reported as broken had never actually been built.

**The fix.** A **press-and-hold (~320ms) then drag** now repositions the bar,
keeping the existing flick-to-navigate gesture intact. The pill is narrower
(`--fabnav-w: 260px`), which is what creates 98px of travel on a 390px phone.
Position is stored as *ratios*, so it survives rotation; hostile or corrupt
stored values fall back to centre-bottom rather than stranding the bar.

**A second, worse bug found while verifying.** The bar was centred with
`transform: translateX(-50%)`. JavaScript writes an absolute `left`, but cannot
overwrite a CSS transform — so once dragging began, the shim still applied and
pushed the bar **off-screen**. Measured: `x = -16px` at rest, `x = -114px` after
a drag. Centring now lives in `left` alone. This would have shipped as "the
drag is broken" for a completely different reason.

**Verified in Chromium at 320/390/430/844px:** the bar drags, clamps to the
margins, stays below the header, persists across reload, and stays legal after
rotation. **Not yet verified on real iOS or Android hardware** — the long-press
timing in particular needs a human check with a thumb.

**SUPERSEDED 2026-10-03 by E-013.** The press-and-hold trigger is gone, and so
is horizontal travel. Two things in this entry are now historical, not current
behaviour:

- **The hold is no longer the drag trigger.** It is a fallback for a
  *stationary* press only. The trigger is now **vertical movement**; horizontal
  movement is the navigation swipe. A hold could not be trusted as the primary
  trigger because it made the drag conditional on a timing guess (see E-012).
- **There is no horizontal travel and no horizontal position.** The bar is
  always horizontally centred and drags only up and down, per the 2026-10-03
  requirement. The narrow pill that created *horizontal* travel is now just how
  the bar looks; vertical travel comes from the `--fabnav-top: 56px` band down
  to the resting bottom position, which is roughly 300px on a 390px phone.

The centring lessons from this entry still stand and were extended by E-013:
`transform` cannot be overwritten by JS, and *visual* measurements differ from
*layout* measurements while the bar is scaled up.

### E-012 · The drag still did not work on iOS — the callout ate the gesture

**Status:** FIXED · **Found 2026-10-03 · Cause reasoned, not yet confirmed on
hardware**

Human testing after the E-010 deploy: tapping worked, dragging still did not on
iOS. Chromium was green throughout, which is the trap this repo has already
fallen into once (E-004).

**Three iOS-specific defects, none of which Chromium can reproduce:**

1. **The link callout (the primary cause).** WebKit raises an "Open in New Tab
   / Add to Home Screen" menu after a stationary press on a **link** — roughly
   500ms. The bar is five real `<a href>` elements, so a press-and-hold landed
   on one by construction. The callout fires `pointercancel`, which ends the
   gesture before a drag can begin: the bar never moves and the user gets a
   menu instead. `-webkit-touch-callout: none` now suppresses it, declared on
   **both** `.fabnav` and `.fabnav-link` because the property is not inherited
   and the link is what the thumb touches — the same trap as `touch-action`.

2. **A hold long enough to invite it.** The 320ms hold was chosen for
   disambiguation, not with the callout in mind. On iOS the hold is now
   `HOLD_MS_IOS = 90ms`, chosen by capability (`maxTouchPoints > 1` plus a Mac
   platform) rather than user-agent, because **iPadOS 13+ reports as
   "MacIntel"** and a UA check would miss exactly the devices most likely to be
   used two-handed.

3. **A cancelled drag stranded the bar.** `pointercancel` returned early,
   leaving a stale `translate3d` with no `left`/`top` to fall back on — the
   "it half-moved then stopped" symptom. A cancel now settles to a legal
   position and never carries momentum into an edge snap.

Also corrected: `measureTrack` used `window.innerHeight`, which on iOS Safari
reports the viewport with toolbars **hidden**, so the travel band was larger
than the visible area. It now prefers `visualViewport.height`.

**Why Chromium could not catch any of this:** it has no link callout, so
emulated touch never produces one; and `innerHeight` equals the visible height
there. The regression tests therefore assert the *contract* — the property
ships in the CSS, the hold is far below 500ms — rather than claiming the
hardware behaviour is fixed. Note the CSS assertion had to read the
stylesheet **text**: Chromium parses `-webkit-touch-callout` as unknown and
drops it, so it never appears in `rule.cssText`.

**STILL NOT VERIFIED ON REAL iPhone/iPad.** The reasoning is specific and
testable by hand, but "reasoned from documented WebKit behaviour" is not
"observed". Needs a thumb on a real device before this can be called done.

### E-013 · The bar was never actually centred while it was lifted

**Status:** FIXED · **Found 2026-10-03 · Caught by the centring requirement,
not by any gesture test**

New requirement: the bar must be horizontally centred at all times and drag
only vertically. Four defects followed from enforcing that.

**1. The visual box is not the layout box — the real bug.** `data-lifted`
scales the bar to `1.035`, and `getBoundingClientRect()` reports the **visual**
box: 269.1px where the bar is 260px. Every re-centring that read the rect
therefore computed `(390 - 269.1) / 2 = 60.4` instead of `(390 - 260) / 2 = 65`
and placed the bar **9.1px left of centre** — but *only while lifted*. It
looked perfect at rest, which is why nothing caught it. All measurements now
go through `layoutWidth()`/`layoutHeight()`, which use `offsetWidth` /
`offsetHeight` and ignore transforms. This is a genuinely hard trap: a
measurement that is correct 95% of the time and wrong exactly when it matters.

**2. Vertical travel was released instead of dragging.** After pivoting to
vertical-only I left the old rule in place — "vertical goes to the page" —
which was correct for a *horizontal* drag bar and is now exactly backwards. The
axis test is now: **vertical → reposition, horizontal → navigation swipe.** No
timer involved, so no timing value can break the drag.

**3. The stationary-press hold could steal a swipe (a real race).** The hold is
a fallback for a finger that never moves, but the first `touchmove` can arrive
**late**: under CPU load, 8 undelayed touchmoves put it past the 90ms touch
hold. The hold then promoted the gesture to a drag before the axis had ever
been evaluated, and a horizontal flick that should have navigated did not.

The signature was the confusing part — **the test passed when run alone and
failed in the full suite.** That is precisely what a race looks like, and it is
why guessing at it from the failure message would have been wrong. The hold is
now **revocable**: while the finger has travelled less than
`DRAG_THRESHOLD_PX` horizontally the classification is re-checked, and if the
travel turns out to be mostly sideways the gesture is handed back to the swipe
handler, the bar re-placed and the stale transform cleared. Pinned
deterministically by *"a DELAYED horizontal flick is not stolen by the
stationary-press hold"*, which forces the race instead of hoping for it.

**4. Dead code from the pivot.** `movedAt` was written and never read;
`--fabnav-min-travel` and the horizontal half of `Track`/`Dock` are gone.
`isSwipeCommit` is still live — it gates the swipe commit in `onPointerUp`.

**Lesson worth keeping:** `getBoundingClientRect()` returns the box *after*
transforms; `offsetWidth`/`offsetHeight` return the box *before* them. For
anything layout-related — centring, sizing, travel — use the layout box.

### E-014 · "Passes alone, fails in the suite" means a race, not a bad test

**Status:** APPLIED (rule) · **Recorded 2026-10-03**

A test that passes in isolation and fails under load is the clearest possible
signal that something is timing-dependent. Two distinct causes showed up in this
session with the same symptom:

- a genuinely correct test whose subject was being decided by a **timer**
  (E-013 defect 3);
- a real defect where the **layout measurement** was wrong only in the lifted
  state (E-013 defect 1).

Do not "fix" such a test by relaxing it, and do not re-run it hoping for a
different answer. Re-run the suite to get the failure *under load*, and
separately force the timing deterministically so the test pins the race rather
than the machine's mood. A timing-sensitive test that does not deterministically
reproduce its own timing condition is not a regression test.

### E-011 · A green workflow run does not mean the Gemini probe succeeded

**Status:** RESOLVED (recorded 2026-10-03) · **Affects:** operational reading

The availability probes always exit 0 by design, so **every** scheduled run
reports `success` regardless of what Gemini replied. Reading run status as a
health signal is wrong. The real answers are in the logs:

| UTC hour | probe | HTTP |
|---------:|-------|-----:|
| 03 | availability ping | **200** |
| 05 | chat question | 503 |
| 07 | availability ping | **200** |
| 09 | chat question | 503 |
| 11 | availability ping | 503 |
| 13 | chat question | 503 |
| 15 | availability ping | **200** |
| 17 | chat question | 503 |
| 19 | availability ping | 503 |
| 21 | chat question | 503 |

The ping succeeded 3 times in 5; the chat probe has **never** returned 200.
Production is unaffected and still correct: `app.json` reports
`gemini: "failed"` and every event is `rss-description`. **B-004 stays
unvalidated.**

**What the alternating design proved.** At 15:00Z the ping got a 200; at
17:00Z the chat probe got a 503 with only one request spent in between — far
from the 20/day ceiling. So **quota is ruled out** as the cause of the chat
failures, by evidence rather than argument. The 503 body reads `UNAVAILABLE`
/ "high demand" with no `RESOURCE_EXHAUSTED`, which is categorically different
from the quota 429 (`limit: 20`). Always read the body, not the status code.

---

### B-006 · The news list is nine days out of date

**Status:** OPEN · **Affects:** what supporters read every day · **Found 2026-09-30 · Cause measured 2026-09-30**

**What supporters see right now.** The newest article in the app is dated
**2026-09-20**. Today is 2026-09-30. The six items on screen are:

```
2026-09-20  Gustav Lindgren: "Det kändes väldigt bra från första minuten"
2026-09-19  BK Häcken åker till Kalmar – här är matchtruppen
2026-09-11  Julius Lindbergs kvitteringsmål gav delad pott mot Mjällby
2026-09-11  Stötta BK Häcken när du streamar Allsvenskan på TV4 Play
2026-09-11  Fredagsmatch inleder matchtröpehelgen – besöksinformation
2026-09-10  Matchtruppen inför Mjällby på Nordic Wellness Arena
```

**The feeds are not broken.** Every feed reports `ok`, and a manual fetch on
2026-09-30 returned current Häcken headlines — including a Champions League item
and a Europa item. So this is **not** a fetch failure. The overnight job
collected **96 articles and kept 6**:

```
news: 6 candidates, 90 dropped before Gemini, 14 excluded as not men's-team news
```

**What we do not yet know.** *Which* rule discarded the other 90. The nightly
log prints only the total, not a per-reason breakdown, so the cause is not
established. Candidates in `newsPrefilter.ts` include the 45-day window, the
hard-exclude list (season tickets, adverts, shop, opening hours) and the
"no Häcken relation" rule. None of the six survivors would match the hard-exclude
list, so that is **not** the whole story.

### MEASURED 2026-09-30 — cause established

Running the real `prefilterNews()` against the live feeds, four feeds, 89 items:

```
fetched total: 89      kept: 23      dropped: 66

DROP REASONS:
   65  no Häcken relation
    1  general allsvenskan, no Häcken relation
```

**One rule discards 98% of what it drops, and it is working correctly.** Every
one of those 65 is general football — Djokovic, Ronaldo, Damkronorna, a Berlin
marathon, Swedish golf. Dropping them is right. The filter is not broken.

**So the real defect is upstream of the filter.** The feeds themselves only carry
~23 Häcken-relevant items per fetch, and a feed only exposes its most recent
entries. By the time the nightly runs at 03:30 UTC, the freshest items are hours
old and the previous night's have scrolled off. The pipeline is not discarding
today's news — **it is never offered much.**

That is the finding. It inverts the earlier reading in this entry, which blamed
the prefilter. The prefilter is doing its job.

### What the 23 kept items look like

```
2026-09-30  Sportbladet   Storförlust hemma mot Juventus för Häcken i CL
2026-09-30  SVT Sport     Häcken med målvaktsdebutanten Hanna Karlsson nollat igen
2026-09-30  SVT Sport     Hanna Karlsson, 16, gör startdebut för Häcken – mot Juve
2026-09-30  BK Häcken     Juventus FC kommer till Göteborg – detta händer…
2026-09-29  BK Häcken     Tuva Ölvestad: "Det är en ära att få göra detta med mina…
2026-09-27  BK Häcken     Europaspecial – lär känna Hanna Karlsson
...
2026-09-11  BK Häcken     Stötta BK Häcken när du streamar Allsvenskan på TV4 Play
2026-09-11  BK Häcken     Fredagsmatch inleder matchtröpehelgen – besöksinformation
```

Current, real, men's-team Häcken news is present and passing. Note the two
secondary-source items that survive **only** because a current player's name
appears — *"Hanna Karlsson"*, *"Tuva Ölvestad"* — never the word "Häcken". The
`classifyRelevance` path added earlier is doing real work.

**The residual quality problem is separate and smaller:** the last two entries are
a streaming advert and stadium information. They survive because
`publisher === "BK Häcken"` bypasses the "no Häcken relation" test
(`newsPrefilter.ts`), and the hard-exclude list does not match them. That is a
narrow, fixable gap — not the cause of the staleness.

### Why supporters still saw nine-day-old news

The nightly log for 2026-09-30 reports `6 candidates`, yet the same code on the
same feeds now keeps 23. The difference is **when** it ran: at 03:30 UTC the
Champions League items did not exist yet, and the day's news had not been
published. A once-daily fetch at 03:30 samples one narrow slice of the news
cycle.

### Next action, in order

1. **Fetch more often than once a night.** Everything else is secondary while the
   feed is only sampled at one hour. Two or three runs a day would capture items
   that exist for a few hours each. **Still not implemented** — the root cause is
   measured and documented, but no code changes yet.
2. ~~**Report the drop breakdown in the nightly log**~~ — **DONE 2026-09-30,
   `a1d4878`.** See "per-source ingest diagnostics" below.
3. **Only then** narrow the club-administration items.

**Do not widen the 45-day date window.** It is not the constraint; the constraint
is *when* we look, not *how far back*.

### DONE 2026-09-30 — per-source ingest diagnostics (`a1d4878`)

Action 2 above is now implemented. The nightly log gained a per-source
breakdown showing **fetched / kept / dropped, with drops broken down by
reason**, and explicitly flags any source that fetched items but contributed
nothing:

```
    BK Häcken         fetched  23  kept   6  dropped  17  (no Häcken relation 17)
    Göteborgs-Posten  fetched  45  kept   0  dropped  45  (...)  <-- ZERO CONTRIBUTED
    news ingest by source: 8 sources, N fetched, M kept — 1 source(s) returned items but contributed NOTHING: Göteborgs-Posten
```

**Why this was needed.** `freshness.sourceStatus` reports a source `"ok"`
whether it contributed 20 articles or none, and the pre-existing log printed
only a *total* drop count. Together those two signals were ambiguous: a source
that fetched successfully and contributed nothing was indistinguishable from
one feeding the pipeline normally. That ambiguity is why B-006 took hours to
diagnose instead of minutes.

**Where it lives.** `pipeline/src/ingestDiagnostics.ts` — **not** in `run.ts`.
`run.ts` calls `main()` at module scope, so importing it from a test would
execute the live pipeline with real network fetches. Same trap as
`geminiSemanticEval.ts`. The logic is pure functions over handed-in data;
`run.ts` calls it. **7 new tests, 349 → 356.**

**Proof it changed no filtering.** `git show a1d4878 -- pipeline/src/run.ts` is
**+19 lines, zero deletions** — no existing line altered. Not one candidate is
kept or dropped differently. `app.json` was not regenerated; served and
committed hashes both `c8e247cb…`.

### DONE 2026-10-05 — the counts are now visible in the app (`c3c71ca`)

The diagnostics above lived only in the nightly's console output, which is gone
by morning and invisible to a supporter. The app now shows the same numbers:

- **Settings → Nyhetskällor**: each feed shows how many articles it actually
  contributed ("3 av 20 artiklar behölls"), with an **i** button explaining in
  plain Swedish what the source does and what breaks without it. The button is
  a real tap target, not a hover tooltip, because this app lives on phones.
- **Teknisk information → Mätlogg**: per-publisher counts under the rolled-up
  feed row, and a table showing kept/fetched per source across the last eight
  nightly runs. A run from before the measurement existed renders as **"—"**;
  a source that answered and contributed nothing renders as **0**. Those are
  different facts and the UI keeps them different.

**First real numbers (2026-10-05):** 143 fetched, 6 kept — BK Häcken 3/20,
Fotbolltransfers 3/20, and **six feeds contributed nothing**: Sportbladet 0/39,
Expressen 0/20, SVT Sport 0/20, Göteborgs-Posten 0/13, Allsvenskan 0/10,
Bollsvenskan 0/1. Every one of them reported "ok". That is the ambiguity this
feature exists to make visible.

**Honesty rules enforced by tests.** "Not measured" must never render as 0
(unit test on `noteSourceArticles`, e2e on the dash cell). A non-article
service (sportomedia) shows "Ej mätt", not "0 artiklar". A new feed with no
description fails `sourcePurpose.test.ts` loudly instead of rendering a
generic row.

**Two things found while building it.** There is a **second filter stage**,
`menRelevantNews()`, which runs *after* the prefilter and removes women's-team
items. Without accounting for it the per-source arithmetic would not reconcile,
so those exclusions are reported under the reason `not men's-team news` and a
test asserts `kept + dropped == fetched` per source. The builder also routes
unattributable drops into an explicit `(unattributed)` bucket and any
arithmetic remainder into `unaccounted`, so totals stay honest rather than
silently vanishing.

**Not yet verified in production.** The rendering above was checked against
synthetic data only. It has not yet appeared in a real nightly log — the first
opportunity is the 03:30 UTC run.

### DONE 2026-09-30 — added the Fotbolltransfers club feed (`2ba0f78`)

A seventh source now covers the transfer and contract news the general sports
feeds miss entirely:

```ts
{ url: "https://fotbolltransfers.com/rss/klubbar/27", publisher: "Fotbolltransfers" }
```

Found via the `href="/rss/klubbar/27"` link the club page declares — **not** by
guessing paths. Guessing fails here: `/rss` and `/nyheter/feed` both return
**HTTP 200 with a full HTML page and zero RSS markers**, and `/feed` and
`/rss/klubbar/27/nyheter` return 404. A status-code-only check would have
accepted two HTML pages as working feeds. `fetchRss` checks `res.ok` *and*
parses for `rss`/`feed`, so it rejects them correctly.

Verified end to end — 20 items fetched, 6 survive the prefilter:

```
2026-09-28  "Krävs för att BK Häcken ska fortsätta vara konkurrenskraftiga"
2026-09-17  LISTA: Kontraktsläget i BK Häcken
2026-09-11  "Jag hoppas verkligen att jag kan överbevisa dem"
2026-09-04  Officiellt: Lämnar Häcken för division 2-klubb
2026-09-02  Officiellt: BK Häcken lånar ut Sanders Ngabo
2026-09-02  Uppgifter: Sanders Ngabo lämnar Häcken
```

Real gaps filled: **Sanders Ngabo** and a **division-2 departure** appear in no
current feed. 14 of 20 are correctly dropped as general Allsvenskan or
unrelated — the prefilter is doing its job here too.

**Still 2 days stale** (newest item 28 Sep), so this does **not** fix the
staleness. It adds a source that needs the same fetch-more-often treatment as
the rest.

---

### ADDED 2026-09-30 — Göteborgs-Posten, and one source that could not be added (`c15d9c9`)

An eighth source, for **regional/local Häcken coverage** the national sports
feeds structurally cannot carry:

```ts
{ url: "https://www.gp.se/rss", publisher: "Göteborgs-Posten" }
```

`"Göteborgs-Posten"` was **already registered** in `PUBLISHER_ROLES` as
`"secondary"` — the repo had anticipated this source. No role wiring was needed.

**Verified:** HTTP 200, `text/xml`, 45 items, freshest `pubDate` 2026-09-30
19:22 GMT, and confirmed through the real `fetchRss()` (`ok:true, items:45`).

**Two traps, both worth remembering:**

1. **The server sends GZIP while declaring `content-type: text/xml`.** A plain
   fetch without decompression yields binary, and a naive `<rss` marker check
   reports "0 RSS markers" — a **false soft-404 negative**. This is the same
   class of trap as fotbolltransfers, but inverted: there, HTML returned 200;
   here, a real feed looked empty.
2. **Yield is low by design: 3 of 45 items mention Häcken.** This is the
   **front-page** feed. No sport feed exists — `/sport.rss`→404,
   `/sport/feed`→410, `/arkiv/sport.rss`→404 — so the front page is the only
   option. The 3 that survive are local coach/supporter press ("Häckens plan –
   så ska storkubbarna vältas") that no other feed carries. **Do not "fix" this
   later by expecting article density** — the trade-off is intentional and
   documented in the code comment.

**Not live yet.** The feed has **no effect until the next `data-update.yml`
nightly run**, and `app.json` contains zero GP articles as of this writing. The
deploy of `c15d9c9` was verified **data-neutral**: served and committed
`app.json` hashes identical at `c8e247cb…`, and the client bundle
(`index-B9Si6Jzq.js`) was unchanged — correct, because `RSS_SOURCES` is
pipeline-side and never enters the bundle.

#### fotbollskanalen.se — identified, NOT added

The AI Studio app listed this as a source. **There is no feed.** Every candidate
returns HTTP 200 with **Next.js HTML and zero items**: `/rss`, `/feed`,
`?feed=rss2`, `?feed=rss`, `?feed=atom`, `?rss`, `/arkiv`, `/rssfeed`.

The trap: `/min-feed` is declared as an `href="..."` in the page HTML, which
makes it look authoritative. **It is a web page, not a feed.** The site is
Next.js + Sanity (`cdn.sanity.io` in its image URLs).

**Getting this source requires scraping, not configuration.** That is a
different piece of work with different failure modes, and it is **not** part of
B-006. It was left undone deliberately rather than half-done.

---

### B-003 · News stories never combine sources

**Status:** OPEN · **Affects:** what supporters read every day

**What happens today.** The app finds Häcken-related articles and shows each one
as its own card. On the morning of the Kalmar match, five separate outlets
covered the same 5–0 win. A supporter scrolling the news layer sees five cards
that all say roughly the same thing.

**What it should be.** One card per real-world event. When several outlets cover
the same thing, the card shows one summary plus every source, so a supporter can
trust it more, not less — and does not have to read the same news five times.

**Why it is not done.** Grouping differently-worded headlines automatically is
genuinely hard, and doing it badly produces a *worse* mistake: one card claiming
to be about something it is not. That exact failure happened in production (see
**B-004**). Rather than ship something unreliable, the app currently shows
everything separately. Single-source is honest; wrongly-merged is not.

**What closing it needs.** A grouping method that has been shown, on real data,
not to merge unrelated stories. The Gemini-based approach exists and has a
corrected prompt, but it has not yet been proven to work — see **B-004**.

**Acceptance:** a card in the live app carrying two or more sources, each with
its own outlet name, headline and link.

---

### E-005 · A departed player still shown as at risk of suspension

**Status:** data effect pending · **Affects:** the "Kortläget" card list

**What happens today.** Amor Layouni has left BK Häcken. The app still lists him
under "players to keep an eye on", showing two cautions from earlier in the
season. Those cautions are real and should not be deleted — the season record is
history. But listing a player who no longer plays here as a current risk is
simply wrong.

**What it should be.** Retain his row and his two cautions, but mark him as no
longer at the club rather than counting him among current players to watch.

**Why it is not showing yet.** The code fix is written, tested (13 tests) and
deployed. Data files are only rewritten by the overnight job, and last night's
run used the code from *before* the fix. Tonight's run will use the corrected
code.

**How to confirm it worked:** after the ~03:45 UTC run, his status should read
"departed" rather than "at risk", his caution count should still be 2, and the
list should still contain the same number of people as before — no history
removed. If a row disappears, that is a defect, not an improvement.

---

### N-001b · iPhone search field shifts the page sideways

**Status:** OPEN — needs physical-device check · **Affects:** iPhone users only

**What was reported.** On an iPhone 13, focusing the player search field made the
surrounding layout jump horizontally.

**What we know.** Automated checks on the deployed app at iPhone 13 and iPhone SE
sizes found **no** sideways movement — no scroll range, no layout shift, and the
known iOS trigger (a form field under 16px, which makes Safari zoom on focus) is
already guarded against in the stylesheet.

**Why it is still open.** The tests assert invariants that hold on any browser.
An invariant passing in a desktop emulator is **not** the same as observing the
defect gone on the device where it actually happened. This is a known trap: the
original swipe-to-dismiss bug (**E-004**) was invisible to automation and only
appeared on real hardware.

**Next action:** open the deployed app on the physical iPhone 13, tap the search
field, and watch whether the layout moves sideways.

**Do not mark this accepted because automated tests pass.**

---

### N-001a · Match statistics are not shown

**Status:** OPEN, waiting on a data source · **Affects:** the match sheet

**What happens today.** Opening a finished match shows the goalscorers,
substitutions and cards. It does not show possession, shots or corners, and says
so honestly rather than showing a guess.

**Why.** A previous version inferred these numbers from the timing of goals. That
was removed deliberately — inferred statistics are fabricated statistics, and a
supporter would have no way to tell them from real ones.

**What closing it needs.** A reliable source of real match statistics. Until one
exists, the honest absence is the correct product behaviour.

---

### Former-player details · photos, transfers, statistics

**Status:** LARGELY CLOSED 2026-10-06 — Wikipedia narrative added, the five
device-reported UX defects fixed; transfers/contract remain open

**What happens today.** The player sheet shows, when the sources record it:

- **Wikipedia narrative** — the lead paragraph of the Wikipedia article ABOUT
  THIS EXACT ENTITY, found via the sitelinks Wikidata already returns and
  verified by `wikibase_item`. This is the fix for "the data is lousy": the
  article says what the player is doing NOW ("spelar för PAOK") and tells the
  career story the structured claims never will. One request per open, cached
  for the session; a null result is cached too.
- **Photo** — full image, no crop (the first version cut heads off with
  `object-fit: cover`).
- **Position, career timeline, national teams** — as shipped 2026-10-05.

**The five device-reported UX defects, all fixed 2026-10-06:**

1. **Sheet covered the header** — a tall sheet slid under the translucent
   banner, hiding its own title. The sheet is now bounded by the chrome on
   BOTH sides (`--chrome-top` mirrors `--chrome-bottom`).
2. **Images cropped** — `object-fit: cover` with a hard max-height cut the top
   of portraits. Now shown in full.
3. **Favorites were a dead end** — the snapshot stored only name and dates, so
   opening a starred player showed an empty card and the user had to search
   again. The FULL card is now stored, and opening a starred player triggers a
   background refresh that replaces the card when fresh data arrives (old data
   is kept if the refresh fails).
4. **Results were invisible on a phone** — they rendered below the favourites
   list, under the on-screen keyboard. Results are now a dropdown attached to
   the search box, in the band the keyboard never covers.
5. **Exact spelling was required** — search was submit-only. Now it fires
   400ms after typing stops (Wikidata's index is prefix-based, so "jere"
   finds Jeremejeff), with the session cache absorbing repeats.

**Search forgiveness, measured 2026-10-06.** The prefix index alone was not
enough, so a cirrus full-text fallback (`query* haswbstatement:P106=Q937857`)
fires whenever the primary path returns no footballers. What each strategy
actually covers, all measured against the live API:

- **Primary path** (`wbsearchentities`): full names, diacritic-stripped
  ("tofting" → Tøfting, first hit), and multi-word partials ("Alexander Jere"
  → direct hit).
- **Cirrus fallback**: short single-token prefixes. "bjar" → Bjärsmyr
  (position 16 of 50); "jere" → 8 real footballers (Doku, Frimpong, Recoba…)
  where the primary path surfaced Jeremy Bentham, Corbyn and Irons.
- **Measured limitation**: Jeremejeff himself sits at position 86 of 335 for
  `jere*`, so he appears from "jereme" (6 chars, via the surname fallback)
  but not from 4 chars. A missing-letter typo ("jeremejev") matches other
  real people (the Eremeevs) and is unrecoverable from any Wikidata endpoint.
  These are index limitations, not code gaps.

**The identity trap worth remembering.** A Wikipedia title match is NOT an
identity match: "Mats Hedén" on sv.wikipedia is a MUSICIAN (Q5795456); our
footballer is Q103846058. Every summary is checked against `wikibase_item` and
a mismatch is discarded — showing a musician's biography beside a footballer's
stats is exactly the confident-wrong-answer this app refuses to ship.

**The infobox layer — the structured data Wikidata does not have
(2026-10-07, `dedaa51` + `64e124c`).** The narrative layer fixed "what is the
player doing now", but the structured fields stayed thin because Wikidata's
claims are thin. Measured on the user's own examples:

- Mats Hedén (Q103846058): P2048 (height), P413 (position) and P54 (career)
  ALL ABSENT in Wikidata — the card showed three honest gaps. His English
  Wikipedia infobox has all of it.
- Bénie Traoré (Q106464198): P54 has one stint with NO year qualifiers —
  "????–???? BK Häcken". The infobox has the whole career.
- Martin Ericsson (Q602051): Wikidata's P582 says 2012 — the "career cut
  off at 2012" the user reported. The infobox says 2012–2016.
- Jeremy Agbonifo: height but no position, one unqualified stint. The
  infobox has Ytter, vänsterfotad, and every loan.

The fix reads the lead-section wikitext (`action=parse&prop=wikitext
&section=0`, CORS-open, ~0.8s, one request per language, cached 30 min) and
parses the infobox with a brace-AND-link-depth-aware walker — a pipe inside
`{{...}}` or `[[a|b]]` is not a field separator (the `[[a|b]]` case broke
Traoré and Hedén before it was caught by probes). National-team rows use the
`{{hff|CIV|u=23}}` template, which raw wikitext leaves opaque; expanding the
WHOLE infobox returns an HTML table (measured), so the templates are
extracted, expanded in ONE batched `expandtemplates` request, and the team
link substituted back.

Identity is chained, never assumed: the infobox is fetched only for the
sitelink title of an entity whose summary already passed the `wikibase_item`
guard — the musician trap applies here too ("Mats Hedén" sv.wikipedia).

**Merge rule and the tie that mattered (`64e124c`).** Wikidata and infobox
data merge per field: height/position prefer Wikidata, career/national go to
whichever list is fuller. The first version broke ties toward Wikidata — and
Ericsson is exactly a tie: both lists have 7 rows, but Wikidata's says
Häcken 2012–2012 while the infobox says 2012–2016 with 109/24. Ties now go
to the infobox, with a provenance note ("Från Wikipedia — Wikidata saknar år
och matcher för de här perioderna") whenever it wins.

**Verified live on the deployed build (`64e124c.816c757`):** Hedén 182 cm /
Defender / 2 stints; Traoré 172 cm / Ytter / Häcken 41·15 → Sheffield →
Nantes (lån) → Basel 60·21 + 2 national teams; Ericsson 2012–2016 Häcken
109·24 with the loan stint marked; Agbonifo 178 cm / Ytter / Vänsterfotad /
5 stints with 3 loans. A manual refresh button (spinning while it works)
clears all three caches and re-fetches — the escape hatch when a stale
null-cache hides new data.

**Search honesty, shipped with it.** The search indicator now names its
stage ("Söker i spelarregistret …", "Söker djupare i registret …", "Hämtar
spelaruppgifter …", "Hämtar klubb- och landsuppgifter …") so a 10-second
cold search shows WHERE it is instead of looking frozen.

**Why not the AI-research route.** Evaluated and rejected (2026-10-05): the
Wikipedia route is free, CORS-open, and auditable. See "Player enrichment —
why not the AI" below.

**What is still open.** Transfers and contract status. Neither Wikipedia's
summary nor Wikidata models them reliably; the honest absence remains.

**Acceptance (met for the shipped fields):** each field appears only when it
comes from a citable source — the Wikidata Q-ID and the Wikipedia article are
both linked in the sheet.

---

## Closed items — what supporters gained

| Item | What it was | Outcome |
| --- | --- | --- |
| **E-001** | The card-watching list was capped at 4 rows while claiming to show 5 | Shows every qualifying player |
| **E-002** | "1 caution left", "3 cautions", "suspended" all appeared separately and repetitively | Grouped into one clear state per player |
| **E-003** | A player who had left the club was counted as a current risk | Removed from the current count |
| **E-004** | Swiping down did nothing on real iPhones (works in emulators) | Works on real touch devices |
| **E-010 – E-013** | The menu bar could be tapped but not dragged, and was never actually centred | Vertical dragging removed as over-engineering; the bar is now a fixed floating pill with a glass indicator that follows the thumb and springs to the nearest destination. The iOS link callout no longer eats the gesture. Superseded in part by **E-015** |
| **E-006 – E-009** | Former-player identity could be wrong or unsourced | Now resolved from live sources, with provenance recorded |
| **B-002** | News cards had no images | Feed supplies them |
| **B-007** | The news archive printed the same date twice — a "2 SEP." heading immediately followed by "2 sep." on the row beneath it | Each day now shows its date once; recent days keep a useful relative heading |
| **E-015** | On a real iPhone the menu was too small to tap reliably, and the selected indicator poked out past the bar's rounded edge | Menu scaled ~50% wider for thumb use; the indicator is now a concentric band with the smallest uniform gap. See the detail below |
| **B-007** | The news archive printed the same date twice — a "2 SEP." heading immediately followed by "2 sep." on the row | Each day now shows its date once; recent days keep a useful relative heading |
| **E-015** | On a real iPhone the menu was too small to tap reliably, and the selected indicator visibly poked out past the bar's rounded edge | Menu scaled ~50% wider for thumb use; the indicator is now a concentric band with the smallest uniform gap |
| **B-005** | The overnight data job could finish successfully and never actually publish — data silently went stale for two days | Deploy guard now proves committed bytes match served bytes |
| **E-016** | The measurement log under the cog wheel was unreadable on a real iPhone — the value grid was crushed to 24px and labels wrapped mid-word | Root cause was a **CSS class-name collision**, not a sizing bug: `.mrow` already belonged to the archive match list and its `display: flex` was silently inherited. Cell width 24px → 160px, measured at 390px |
| **E-017** | A source that is switched off showed "1 anrop" beside its "Ej påslaget" pill | A call that never left the machine is not a call. `calls` now counts real attempts only, pinned by an invariant test that the per-service counts must sum to the run total |
| **B-010** | CI had been red for 17 runs and I explained it as "tests are parallel-sensitive" | **That explanation was wrong.** Real causes: WebKit was never installed (21 failures, nothing tested), plus a 45s budget and uncapped workers that never fit two browser projects on one runner. Both fixed; CI run `37264656883` is **green** |
| **B-011** | WebKit touch tests asserted things a synthetic event *cannot* prove, and one sized a gesture to a wrong hardcoded pitch | Assertions scoped to what each engine can actually verify; the gesture is now sized from measured geometry. The app was correct — the test was wrong |

---

## Known limits — honest answers to "why doesn't the app do X?"

- **No match statistics.** Deliberate. See **N-001a**.
- **No detailed former-player biographies.** Deliberate. Fields appear only with a
  trustworthy source.
- **Some former players show no photo.** Photos are sourced, not uploaded or
  guessed.
- **News never combines sources today.** A known quality gap, tracked as **B-003**.
- **One stale entry appears until tonight's run.** Tracked as **E-005**.

---

## Do not

- **Do not hand-edit the data file** (`public/data/app.json`). It is generated.
  Editing it to make a problem disappear destroys the evidence that the real fix
  works.
- **Do not re-enable the experimental AI news grouping in production.** It was
  switched off after it produced false merges, and the corrected version has not
  been proven safe yet. See **B-004** in the technical archive.
- **Do not run the data pipeline casually.** It rewrites live content.
- **Do not mark the iPhone search issue fixed** without checking the real device.

---

# Engineering status (technical)

*Everything below is for engineers. The sections above are the business view.*

## Status at a glance

| Item | Status | Notes |
| --- | --- | --- |
| **B-003** | OPEN | Live data is **6/6 single-source**. UI supports multi-source; the pipeline does not produce it. Depends on B-004 |
| **B-004** | OPEN — **UNVALIDATED** | Prompt fixed (`c73b820`) + offline test green. **Zero usable answers in 20+ live attempts.** Availability measured over 35 runs: ping **10/21 (48%)**, chat **0/15 (0%)**. Gemini is **reachable, not down** — but the real-work probe has never succeeded, and the two probes fired on **disjoint hours**, so shape and time-of-day are still confounded. Probe schedule **stopped 2026-10-04**; one-request runs still available by hand |
| **E-005** | **DONE — verified in production 2026-10-01** | Served `app.json` shows Layouni `status: "departed"`, `departed: true`, with history preserved (`warningCount: 2`, both `relevantWarnings` intact). 18 ledger entries, `cardMatchesInspected: 22` |
| **N-001a** | OPEN | `MatchDetail.playerStats` declared, never populated. No inferred stats, ever |
| **N-001b** | OPEN | Needs physical iPhone 13 verification. **Automation cannot close this** |
| **B-006** | OPEN — cause **measured** | News is 9 days stale, but **the prefilter is innocent**: of 66 drops, 65 are general football it correctly rejects. Feeds carry ~23 Häcken items at most, and the nightly samples them **once at 03:30 UTC**. Fix = fetch more often, not filter differently |
| **B-006 diagnostics** | **DONE** (`a1d4878`) | Per-source fetched/kept/dropped-by-reason now in the nightly log, with a `ZERO CONTRIBUTED` flag. +7 tests, 349→356. **Not yet seen in a real run** |
| **B-008** | **OPEN — transport PROVEN, quality UNVALIDATED** | **OpenRouter free tier works where Gemini did not.** Same chat payload: Gemini **0/15**, OpenRouter **1/1 (200)**, 5/5 items parsed, **0 credits**, 1000 req/day. So Gemini's failure was **provider-specific, not a property of the task**. Still not a quality verdict — B-004's false-merge risk is untested. See below |
| **B-009** | **DONE** | A unit test hardcoded a fixture date and asked the code to compare it to the real clock. At 15:00 UTC on 2026-10-04 the fixture silently became historical and the test began failing on its own — **with no code change**. Because CI and deploy both run the suite, it was **blocking every deploy**. Dates now derive from the clock at call time; no production code touched. Suite is **396/396 green** |
| **Sources** | 8 feeds | `fotbollskanalen.se` has **no feed** — Next.js HTML behind every candidate URL. Needs scraping; deliberately not added |
| E-001 – E-004 | DONE | Verified in code |
| E-006 – E-009 | DONE | Superseded by the Wikidata search redesign |
| B-002, B-005 | DONE | B-005's deploy guard ran and **passed** — do not reopen |
| **E-015** | **DONE** — verified on device | Indicator 0.00px protrusion on all 4 edges at all 5 tabs, off-centre ≤0.10px, radii 32/28 (concentric). Tab targets 71×78px. Public build `c109164.1fb897f` |
| **B-007** | **DONE** | Duplicate measured on 47 of 60 days. Now impossible by construction; pinned by an invariant asserted across a full year |
| **N-001c** | **OPEN** | **The Liquid Glass menu's touch behaviour is verified only in Chromium and in synthetic-event WebKit.** Playwright's CDP touch injection is Chromium-only (`newCDPSession` throws in WebKit), so the WebKit project dispatches synthetic `PointerEvent`s that bypass iOS's **native gesture recogniser** — the layer that decides scroll-versus-drag and raises the link callout. Hardware testing found four defects Chromium could not. Treat any future change here as **unverified until a thumb confirms it** |

### Reusable: `.github/skills/liquid-glass-tab-bar/SKILL.md`

The token set, the concentric-geometry arithmetic, the touch-action rules and the
seven iOS-only traps are written up as a reusable skill, for reuse in this project
and in other PWAs. Written from what actually broke, not from how the code looks
now.

### Deploy discipline this session — two data-neutral deploys

`c15d9c9` (GP feed) and `a1d4878` (diagnostics) both reached production. **Neither
changed `app.json`.** Verified each time by hash, never by run status:

| Commit | Change | Committed = served | Bundle |
| --- | --- | --- | --- |
| `c15d9c9` | GP feed added to `RSS_SOURCES` | `c8e247cb…` = `c8e247cb…` | `index-B9Si6Jzq.js` unchanged |
| `a1d4878` | Per-source diagnostics, `+19/-0` in `run.ts` | `c8e247cb…` = `c8e247cb…` | `index-B9Si6Jzq.js` unchanged |

**Why the bundle never changes:** `RSS_SOURCES` and the diagnostics are
pipeline-side. They run in `data-update.yml`, never in `deploy.yml`. This is the
correct outcome, not a defect — and it is exactly the state a reader might
mistake for "the deploy did nothing". Per `AGENTS.md` §1–§3, a green run proves
nothing about data; the hash comparison is what proves it.

**Pipeline is never triggered by a push.** `deploy.yml` = checkout → npm ci →
typecheck/test → build → upload → deploy. No pipeline step, no
`GEMINI_API_KEY`. `ci.yml` runs `pipeline:validate` (validates *existing*
data), not `npm run pipeline`. **Every push to `main` therefore costs zero
Gemini requests.**

## B-004 · the AI news grouping defect — why it is still off

**Root cause (established, do not re-derive).** `SYSTEM_INSTRUCTION` in
`pipeline/src/gemini.ts` read:

> *"Artiklar om samma match, samma resultat, samma transfer eller samma skada
> hör till samma händelse, ÄVEN om rubrikerna skiljer sig helt."*

A pre-match **matchtrupp** announcement and a post-match **matchrapport** are both
"samma match", so that sentence **actively commanded the false merge**. Every
false merge seen in production has exactly this shape: a pre-match service
article absorbed into the post-match result event.

**The fix.** Two rules added (`c73b820`): material **före** matchen (matchtrupp,
förhandsprogram, besöksinformation) is a separate event from material **efter**
matchen (matchrapport, referat, resultat) — while reports of the same **avslutade
utfall** still merge, so `t3`–`t6` remain one event. That second clause is
deliberate: over-correcting into "never merge same-match reports" would trade one
false merge for four near-duplicate cards and regress **B-003**.

**Why it is still OFF.** The offline test (`geminiSemanticEval.fixture.test.ts`)
proves the prompt **states** the rule. It does **not** prove Gemini **obeys** it.
The one authorised live evaluation — run `36747767583`, 2026-09-30, exactly
1 request — returned:

```
HTTP 503  "This model is currently experiencing high demand."  UNAVAILABLE
RESULT    capacity-blocked-503
"No semantic conclusion is possible. Do not re-run repeatedly."
```

**A 503 is a transport failure, not a verdict.** No grouping output was produced,
so "does Gemini keep t1 out of t3–t6?" is **still unanswered**. It is not evidence
the fix works and not evidence it fails. **B-004 must not be described as fixed.**

### ⚠️ CORRECTION 2026-10-01 — the quota is NOT eliminated. It is the ceiling.

An earlier version of this file stated that *"no 429 has ever been observed, so
quota is eliminated too"* and that *"the remaining 503s are transient
sector-wide capacity."* **Both statements were wrong.** A 429 was subsequently
captured with its full body, which names the limit:

```
HTTP 429  RESOURCE_EXHAUSTED
"Quota exceeded for metric:
 generativelanguage.googleapis.com/generate_content_free_tier_requests,
 limit: 20, model: gemini-3.8-flash"
```

**The key is FREE TIER, hard-capped at 20 generation requests per UTC day.**
That "20 RPD" figure had been recorded for days as an assumption; it is now
**measured**, read directly out of the error body.

This overturns the sector-wide-capacity narrative. Once the free tier's daily
allowance is spent, further attempts surface as **503 UNAVAILABLE "high
demand"** rather than 429. The 503s and the 429 are most likely the **same
exhausted quota under two different codes** — which also explains, better than
capacity ever did, why a 586-byte request and a 23 KB request failed
identically. *Observed, not vendor-confirmed: `status.ai.google.dev` does not
resolve from this network, and no Google statement has been read.*

**A lone HTTP 200 is not a health signal.** Run `36813438657` returned 200 at
04:05:04Z and 429 **0.2 seconds later**, because that job was already at the
daily ceiling. A single success from a quota-bound key proves only that the
request was number 20, not that the service is available.

**The binding blocker is the missing validation** — `gemini-budget-check.sh`
guarantees ≤1 `generateContent` call, only after a free metadata check, with no
retry, no fallback and no loop. On a 20/day budget shared with the production
nightly (which needs 12 when Gemini is enabled: 4 models × 3 attempts), that
budget cannot be met from the free tier at all.

**To close B-004:** one successful `gemini-semantic-eval.yml` run showing `t1`
grouped separately from `t3`–`t6`. Requires explicit human authorisation. Do not
spam re-runs; repeated 503s are what produced this repo's 84-request history —
and the 11-run burst on 2026-09-30 is itself what exhausted the 20/day
allowance and produced the 429s it then investigated.

---

## Gemini capacity — measured 2026-09-30, and a hypothesis disproved

Fifteen requests were spent on 2026-09-30 establishing what the 503s actually
depend on. Most produced nothing. The useful outcome is that a plausible theory
was **tested and refuted**, so it should not be retried.

| run(s) | input | `maxOutputTokens` | result |
| --- | --- | --- | --- |
| `36749728598`, `36750319760` | ~0.3 KB | **32** | **200** ×2 |
| `36755169451` + 11 more (`semantic-eval`) | ~23 KB | ~1024 | **503** ×12 |
| `36759857600` (`gemini-chat-probe`) | **586 bytes** | **2048** | **503** |

**What was believed.** The 23 KB payload fails where a 0.3 KB ping succeeds, so
*payload size* was assumed to be the cause. The obvious remedy followed: shrink
the eval payload.

**Why it is wrong.** Run `36759857600` sent **586 bytes** — barely more than the
ping that succeeded — and still returned 503. **Input size is not the
discriminator.** Shrinking the eval payload would most likely not fix it, so that
recommendation is withdrawn.

**THEORY WITHDRAWN — superseded by the documented cause below.** An earlier
revision of this section claimed `maxOutputTokens` was the discriminator. That
was inference from a correlation and it is **wrong**. Do not act on it.

---

## The availability experiment now running (set up 2026-10-02, `bc9e631`)

**This is a measurement, not a fix.** It cannot make Gemini work. Its only
purpose is to answer one question — *is the free tier usable at all, and if so
when?* — cheaply enough to run unattended for a few days.

### What was built

`gemini-overnight-availability.yml`, cron `0 3-23/2 * * *` — **11 firings**
(03:00, 05:00 … 23:00 UTC), **one generation request each**, 11/day against a
20/day ceiling. Probes alternate so that a failure can be attributed:

| Probe | Script | Question it answers |
| --- | --- | --- |
| 1 | `gemini-availability-sample.sh` | Is the endpoint reachable at production settings? |
| 2 | `gemini-chat-probe.sh` | Is a **usable structured answer** obtainable at all? |

**Why alternate instead of running both in one job.** On 2026-10-01 at 04:05Z a
single job returned **200 at 04:05:04Z and 429 at 04:05:2xZ — 0.2 seconds
apart**. Run together, those two results are unattributable: quota? capacity?
the chat probe's own shape? One request per firing makes a 429 on a probe-1 hour
attributable to the availability ping and a 429 on a probe-2 hour to the chat
probe. **The alternation exists to create that separation** — it is the whole
methodological point, not a scheduling nicety.

Parity is computed inside the job from `date -u +%H` as `(HOUR / 2) % 2`, not
encoded as two cron entries, because a single skipped run would permanently
desynchronise the two signals. *The division by 2 is load-bearing: the schedule
fires on odd hours, where plain `HOUR % 2` is 1 for every firing and would
silently disable the chat probe forever while every run still went green.* That
bug was caught before it shipped and is documented here so nobody reintroduces
it.

### Why this shape, given 20 requests/day

| Design | Requests/day | What it could tell us |
| --- | --- | --- |
| Previous: 5 nights × 2 probes | 10 | Nothing — it re-learned each night what the last night said |
| Attempted: hourly × 1 probe | 24 | Nothing — 20/day ceiling meant hours 20–23Z were **guaranteed 429s** |
| **Now: 11 × 1 probe** | **11** | A real signal, with headroom to spare |

A run that saturates the budget cannot distinguish *"the tier is exhausted"*
from *"the service is unhealthy"* — both look like failure. Staying under the
ceiling is what makes a 429 informative when it appears.

### Expected outcome — stated before the data arrives, so it cannot be rationalised

This is the part to hold me to. In roughly this order of likelihood:

1. **A mix of 200 / 503 / 429 across the 11 hours.** The most likely result, and
   the one that makes the experiment worth running — it would map *when* the
   tier works, which is exactly the question no amount of retrying has answered.
2. **All 503.** Then the "high demand" response is genuine sector capacity, the
   429 was a separate quota wall, and the free tier is unusable at any hour.
3. **A clean run of 200s in a contiguous block.** A genuine daily capacity window
   would finally be visible, and the time to spend the semantic-eval request
   would be obvious rather than guessed.
4. **All 429.** Unlikely at 11/day, but it would mean something is consuming the
   allowance from outside this workflow and must be found before anything else
   is attempted.

**What would count as a genuine result:** a 200 carrying a **non-empty structured
answer** from probe 2. That has never once happened in 20+ attempts. Anything
short of that — including a 200 from probe 1, which is one word, `ok` — is
**not** progress toward B-004.

**What would prove the experiment worthless:** all-503 across all 11 hours *and*
no 429. That pattern would mean the free tier is simply not available to this
key, and the correct response is to stop measuring and get a billing-enabled key
or drop the Gemini path permanently.

### The stop condition — a human must do this

> **On Sunday 2026-10-05, delete the `schedule:` block (or the whole file) from
> `gemini-overnight-availability.yml`.**
> The workflow commits nothing, so **it cannot remove itself.** Left running it
> spends requests indefinitely. This is the one part of the 2026-10-02 work that
> is not automated, and it is the single most important follow-up on the list.

### The limit this experiment cannot lift

Recorded here so the experiment is not mistaken for a path to production. The
production nightly needs **12 requests** when Gemini is enabled (4 models × 3
attempts). These probes need **11**. Together that is **23 against a ceiling of
20** — so **the free tier cannot run the real pipeline even on a perfect day with
zero failures.** No scheduling change fixes that arithmetic. A billing-enabled key
is the only thing that does; until then the deterministic fallback carries the
news feed and that is the correct, safe state.

---

## Gemini 503 — the documented cause (2026-09-30)

**There is no size-dependent component.** Google's own error reference says:

> **`service_unavailable` · 503 Service Unavailable** — *"The service is
> temporarily overloaded or down. Wait and retry with exponential backoff."*

That is the whole definition. No input-size threshold, no output-allowance
penalty, nothing about payload shape. **The earlier payload-size theory in this
file had no documented basis and is withdrawn.**

### What is established fact, not inference

| Question | Answer | Source |
| --- | --- | --- |
| Is 503 size-dependent? | **No** | `api-errors`: "temporarily overloaded or down" |
| Is it quota? | **Yes — it is also quota.** A 429 was captured on 2026-10-01 naming `generate_content_free_tier_requests, limit: 20`. Exhausted quota appears as 429 *and* as 503; the two are not cleanly separable | run `36813438657`, `36805060086` |
| Is it auth or model availability? | **No** | Distinct codes; eliminated by run `36493245277` (200, model listed) |
| Is it retryable? | **Yes** | `troubleshooting`: retry 503 with exponential backoff **plus jitter** — but a 429 free-tier 429 is NOT usefully retryable within the same UTC day |

### Why this session's data looked like a size effect, and why it was not

| run(s) | input | result |
| --- | --- | --- |
| `36749728598`, `36750319760` | ~0.3 KB | **200** ×2 |
| 12 × `semantic-eval` | ~23 KB | 503 |
| `36759857600` (chat probe) | **586 bytes** | 503 |
| `36763020541` (overnight, 2 samples) | 0.1 KB / 0.6 KB | 503, 503 |

The 586-byte request failing while a 0.3 KB request succeeded looked like proof
that input size was irrelevant. It was not proof of anything except that **503 is
not a reliable function of payload size**. Thirteen failures inside one
afternoon is a property of the hour, not of the payload.

With the 20/day free-tier ceiling now known, the likelier explanation for that
afternoon is simpler than "the hour was bad": **the budget was already spent.**
On 2026-09-30, 19 of 22 Gemini requests fell inside the 17:00Z hour alone.

### One real finding that does matter

> *"Higher latency or token usage often occurs because Gemini 3.x models have
> thinking enabled by default."* — `gemini-3.8-flash` defaults to **medium**.

This repo **never sets `thinking_level`**, so every request runs medium thinking.
Setting `low` is the documented lever for cutting latency and token consumption.
It is **not** a fix for 503 — request shape does not change whether an overloaded
server accepts a request — so it must not be applied during a baseline
measurement.

### Measuring the only open question: time of day

> **SUPERSEDED 2026-10-02.** This section described the previous design — five
> samples at 02/04/06/08/10 UTC, two requests per run. That was replaced because
> it spent 10 requests a night re-learning what the previous night's log had
> already said, and because bundling both probes into one job destroyed the
> ability to tell a quota failure from a capacity failure. See **"The
> availability experiment now running"** above for the current design, its cost,
> and its expected outcomes. Kept here for the audit trail.

Everything above is settled. The one thing still unknown is whether availability
varies by hour, and thirteen same-afternoon failures cannot answer it.

`gemini-overnight-availability.yml` samples **03:00, 05:00 … 23:00 UTC — one
request per firing, alternating probes** (see "The availability experiment now
running" above). The description below applies to the *superseded* 02:00–10:00
design and is kept for the audit trail.

It writes nothing and commits nothing — a nightly commit would trigger
`deploy.yml` on unchanged data.

### Honest limits of that measurement

**A scheduled run may simply not happen.** GitHub Actions cron can be delayed up
to ~15 minutes, and scheduled workflows are **skipped entirely** during periods
of high platform load. **An absent run is not a data point.** Always reconcile
against `gh run list --workflow=gemini-overnight-availability.yml` before
concluding anything from the number of samples.

### The AI Studio chat failure — NOT the same proven cause

On 2026-09-30 the AI Studio app in this browser also failed, showing
`Gemini 3.8 Flash · Canceled` and `An internal error occurred`. It is tempting to
call that "the same 503". **It is not established, and this file does not claim
it.**

| | Status |
| --- | --- |
| The REST API returns `503 UNAVAILABLE`, "high demand" | ✅ **Verified** — run `36763020541`, 19:04 UTC, explicit code and message |
| The AI Studio chat is failing | ✅ **Verified** — it demonstrably errors |
| That AI Studio fails **because of** 503 / the same cause | ❌ **NOT established — inference, explicitly withdrawn** |

Three reasons the inference is weak:

1. **The error text differs.** The API returned a machine-readable
   `503 UNAVAILABLE`. AI Studio shows `An internal error occurred` with **no
   status code anywhere in the rendered DOM**. A shared 503 would be expected to
   surface somewhere.
2. **"Canceled" is the wrong word for 503.** A capacity rejection is a refusal —
   the server says no. "Canceled" indicates an aborted turn, which is what a
   dropped stream looks like. Different failure shape.
3. **Different serving path.** AI Studio's assistant runs on Google's internal
   MakerSuite stack; CI calls `generativelanguage.googleapis.com` directly. Shared
   model name does not imply shared serving tier, quota, or queue.

**Also tried and failed:** switching the chat model to **Gemini 3.7 Flash** —
**no model worked**, so this is not 3.8-specific. And `status.ai.google.dev`
could not be reached from this environment (`ERR_NAME_NOT_RESOLVED`), so there
is **no authoritative incident declaration** either way. Any future session must
not cite "Google reported an incident" — that was never established.

**What would settle it:** capture the browser's actual HTTP status on the
assistant request. A `503` confirms the shared-cause theory; a `429`, a stream
abort, or a `500` kills it. This is cheap and was never done.

### Request discipline, honestly

Seventeen requests on 2026-09-30 produced **zero** usable answers. The 12-attempt
eval retry loop was the wrong design: once a payload had failed eight times,
repeating it identically could not yield a different result. Repeating a failed
request is not an experiment. Google's guidance to retry 503s is sound — but it
means backoff with jitter, not a fixed 2-minute cadence, and it is not licence to
spend twelve requests hoping.

**Do not** describe any of this as evidence about B-004. No grouping output was
ever produced. B-004 remains **OPEN and UNVALIDATED**.

## Verification discipline learned the hard way

Recorded because each one caused a real near-miss:

- **A green workflow proves nothing about what users see.** The nightly once
  regenerated and committed data every night for **two days** while production
  served stale bytes. Verify **served** artefacts, by hash, with `curl`.
- **Byte-level comparison, not run status.** The failure mode that matters is
  "green run, stale production" — a run-status check passes in exactly that case.
- **A data-neutral push cannot be validated by the data file.** When a push ships
  no new data, `app.json` is byte-identical whether or not the deploy worked. Use
  the **bundle hash** to prove code shipped, and expect it **not** to change for
  pipeline-only changes.
- **Data generation ≠ data deployment.** Always establish the full lineage:
  pipeline run → data commit → deploy run → served bytes.
- **A successful generation is not proof of correctness.** An HTTP 200 once
  returned two semantically wrong event merges.
- **Automation cannot certify a real-device bug.** The swipe-to-dismiss defect
  (E-004) passed every emulated test and failed on real hardware.
- **A stale service worker will make a shipped fix look broken.** Unregister and
  clear caches before concluding a deploy failed.
- **Do not trust a prior report's numbers.** Re-run the gates and read your own
  output.
- **A test that raises the count proves it ran.** A green suite can pass
  vacuously. Pin the baseline (349 → 356 across 16 → 17 files) so a silently
  unexecuted test is detectable.
- **`+N insertions, 0 deletions` is the strongest available proof of a log-only
  change.** No existing line altered means no behaviour altered — check the diff
  shape rather than trusting the commit message.
- **Two true facts are not a causal link.** "The API returns 503" and "AI Studio
  errors" were combined into a shared-cause theory on correlation alone. Verify
  the mechanism, or label it a hypothesis.
- **Check `date -u`, not the session-context date.** Local CEST (UTC+2) midnight
  is 22:00 UTC the *previous* day. Context saying `2026-10-01` while `date -u`
  says `2026-09-30` is **not a discrepancy** — two timezones. One agent reported
  it as a conflict. Use `date -u` for scheduling decisions.
- **`grep -c` returns exit 1 on zero matches**, which silently truncates a `&&`
  chain. A verification step that "found nothing" may have simply stopped.

---

# Coming back to this project cold

*Start here after a break. Verify anything time-sensitive before trusting it.*

## Where things actually stand (2026-09-30 22:45 UTC)

Four changes shipped this session. **None of them changed `app.json`.**

| Commit | What | Data effect |
| --- | --- | --- |
| `2ba0f78` | Fotbolltransfers club feed (7th source) | none yet — awaits nightly |
| `c15d9c9` | Göteborgs-Posten feed (8th source) + SOURCES.md corrections | none yet — awaits nightly |
| `a1d4878` | Per-source ingest diagnostics, `+19/-0` in `run.ts` | none — log only, by design |
| `c73b820` | B-004 prompt fix | none — Gemini still disabled |

Test suite: **356 passing**, 17 files. Served `app.json`: `c8e247cb…`, generated
2026-09-30 03:46 UTC.

## The one thing to check first

**When you return: reconcile the availability experiment.** The first scheduled
firing under the new design is **03:00 UTC on 2026-10-02**.

```bash
gh run list --workflow=gemini-overnight-availability.yml --limit 15
gh run view <id> --log | grep -aE "utc_hour|parity|probe  |SAMPLE|HTTP |RESULT"
```

Read each run as `probe N -> HTTP code`. What matters is the **pattern across
probe-1 hours and probe-2 hours separately** — that separation is the entire
reason the probes were alternated. Remember: a probe-1 200 is the single word
`ok` and proves nothing about usability; only a probe-2 200 carrying a real
structured answer would be genuine progress.

**Baseline before that first 03:00Z firing, for comparison** — both manual
dispatches, both `probe 2`, both 503:

| run | UTC | probe | result |
| --- | --- | --- | --- |
| `36946497716` | 2026-10-02 00:32 | 2 (chat) | 503, 1 request |
| `36948360050` | 2026-10-02 00:54 | 2 (chat) | 503, 1 request |

**Second thing to check: was the 03:30 UTC nightly healthy, and did GP
contribute?**

```bash
gh run list --workflow=data-update.yml --limit 3
gh run view <id> --log | grep -A 20 "news ingest by source"
curl -s https://danielomazarino.github.io/Min-BKH-app/data/app.json | sha256sum
```

The nightly log should now contain a `news ingest by source` block. **That is
the first time these diagnostics will have run against real data** — every
earlier rendering was synthetic. If a source shows `ZERO CONTRIBUTED`, that is
the flag working as designed, not a failure.

**And the standing item that does not expire:** on Sunday 2026-10-05, delete the
`schedule:` block from `gemini-overnight-availability.yml`. It cannot remove
itself.

**Expect GP to contribute 0–3 articles.** Its feed is the front page, and 3 of 45
items mentioned Häcken when measured. If it shows `kept 0`, that is the
documented trade-off, **not** a bug — and the reason it is flagged rather than
hidden.

## Then, the Gemini question

```bash
gh run list --workflow=gemini-overnight-availability.yml --limit 6
gh run view <id> --log | grep -E "SAMPLE|http=|RESULT"
```

Ten samples across 02:00–10:00 UTC, two per run. **Reconcile the actual run count
first** — cron can be delayed ~15 min or skipped entirely under load, so fewer
than five runs is possible and is *not* itself a finding.

- **Any 200 → the model is back.** B-004 may then be validated with a single
  authorised live eval. That is the gate for B-003 too.
- **All 503 → treat Gemini as unavailable.** Do not spend more requests proving
  it again.

Either way: **do not re-enable Gemini in `data-update.yml`** without a live
semantic verdict. Per `AGENTS.md` §6, a successful generation is not proof of
correctness — and run `36292290265` returned HTTP 200 while producing two
semantically wrong merges.

## Still open, in priority order

1. **B-006 fetch cadence** — cause measured, fix not implemented. This is the
   actual reason news is 9 days stale. Everything else is secondary.
2. **B-004 live validation** — blocked on Gemini. Zero semantic verdicts ever
   obtained.
3. **E-005 data effect** — code deployed; needs one nightly to land.
4. **fotbollskanalen.se** — needs scraping, not a feed. Deliberately not started.
5. **N-001a** match stats, **N-001b** iPhone search — open, N-001b needs hardware.

## Do not redo these

- **Re-derive the 503 cause.** Documented fact: *"temporarily overloaded or
  down"*, no size-dependent component. The payload theory is **withdrawn**.
- **Re-investigate the soft-404 feeds.** Both are documented in `SOURCES.md` with
  the exact URL and the trap.
- **Try to make AI Studio's error explain our 503.** Explicitly withdrawn above.
- **Hand-edit `app.json`.** Generated file. Editing it destroys the evidence.

## Prompt files

`.github/prompts/` — numbered, reusable, each self-contained with its own
constraints and verification steps. `012` (GP feed) and `013` (diagnostics) were
written this session and are **untracked**; commit them if you want them kept.
