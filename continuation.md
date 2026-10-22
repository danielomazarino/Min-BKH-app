# Continuation — session of 2026-10-23

**Read this first.** It supersedes the previous `continuation.md` (the B-029
handoff, committed as `94aaf30`), which is now archived at
`docs/archive/continuation-B-029-handoff-2026-10-22.md`. That document's B-029
content is still accurate and is also mirrored in `docs/ENHANCEMENTS.md` under
**B-029** — read that section rather than the archived file, which is stale in
three places (see §7).

---

## 1. Where the repo is right now

| | |
| --- | --- |
| HEAD | `6ef88b3` — "fix: unrot two e2e fixtures, fix stale search submit, record B-029..B-033" |
| Pushed | yes, `origin/main` |
| Working tree | clean |
| CI | run `39856436718` on `6ef88b3` — **in progress at handoff time** |
| Deploy | run `39856436707` on `6ef88b3` — **SUCCESS** |
| Served build id | **`6ef88b3.1b5a14a`** — verified by curl, matches the pushed commit |
| Served `app.json` sha256 | `e3a3ac81b0a134bf34387eab413ee77094cbdbd97ff4db0e0f8c46f1e8da7650` |
| Committed `app.json` sha256 | `e3a3ac81b0a134bf34387eab413ee77094cbdbd97ff4db0e0f8c46f1e8da7650` — **identical** |
| Served data | 41 `news`, 31 `newsEvents` |

**The data was NOT regenerated this session.** The served bytes are unchanged
from before; only app code and docs were pushed. So the served artifact is
still byte-identical to the committed one, which is the correct state.

---

## 2. What was done this session

Five items were on the table. **One is complete, one is half-done, three are
untouched.**

### Done — item 1: the stale e2e fixtures (B-032)

CI had been red for **8 consecutive runs**. Both failures were assertions
pinned to data the nightly regenerates.

**(a) `e2e/brief.spec.ts`** hard-coded `Kalmar FF` / `0–5` against the real
committed `app.json`. True for one specific match; the current last result is
`Malmö FF` / `0–1`. The invariant is the **order**, not the fixture, so the
expectation now derives from the committed data.

**Mutation-tested.** I deliberately reversed `matchTeams()` to render
Häcken-first and confirmed the rewritten test **fails**. A test that cannot fail
is not a guard. Restored afterwards.

The goalscorer assertion had the same defect (hard-coded `"Lindgren"`; the
current scorer is Svanbäck) and was fixed the same way.

**(b) `e2e/news.spec.ts`** capped card height at 220px; CI measured **222.1px**.
This was a **real layout defect**, not a tight threshold:

- `.ncard-meta` had **151px** of content box
- `"21 okt. · Tidigare spelare"` measures **159px** in Chromium
- → wrapped to two lines → **+14px**

So card height depended on **which category happened to sort first**. A
supporter would see an uneven grid.

Fix: the grid card uses the standard Swedish abbreviation `F.d. spelare`
(127px); `.ncard-meta` is `nowrap` with ellipsis. The list row and the story
sheet keep the full wording.

**Verified:** every card is **208.1px** in both Chromium and WebKit, for `men`,
`women` and `former` categories, at 359/390/430px viewports.

### Done — bonus: a real user-facing bug (B-031)

Found while diagnosing the above, **not** from a user report.

`app/pages/FormerPlayers.tsx` submitted `submit(draft)` — the value from the
last **committed** React render. Type-and-Enter faster than React commits and it
submits the *previous* value, which on the first search is `""`. That calls
`setDraft("")`, **wiping the text the user just typed**, and sets the page to
idle.

Caught from a Playwright failure snapshot showing an empty search box on an idle
page. Reproduced at **1 in 8 runs**; **12/12** after reading the value from the
DOM (`inputRef.current?.value ?? draft`).

This is a real bug on a slow phone, not a test artifact.

### Done — item 2: persist findings to `docs/ENHANCEMENTS.md`

Added status rows and full sections for **B-029, B-030, B-031, B-032, B-033**.

This mattered because the "Frequent news article updates" session **died with
`session.error`** ("400 The requested model is not supported") before it could
persist anything. Its B-029 findings existed only in session checkpoints. They
are now on disk.

### Half-done — item 1b: WebKit flakiness (B-033)

`e2e/former-players.spec.ts` on WebKit is **load-dependent flaky**. A
*different* subset fails on each full-spec run. Observed across runs: lines
359, 367, 396, 428, 474, 517, 524, 552, 625, 644, 655, 686, 708, 717, 735.
Every one passes **10/10 in isolation**.

CI reports them as **flaky**, not failed, because `retries: 1` absorbs them.
The original CI log on `94aaf30` already listed 7 of them **before any change
this session**.

**Not root-caused.** Failure signature: `searchForHit` times out on
`former-player` — the search resolved to something other than a result row under
load. Worth its own investigation.

### Not started — items 3, 4, 5

- **Dead `dedupeKey`** (B-030b) — one line in `pipeline/src/rss.ts`
- **B-029** — Wikidata identity gate, zero lines written
- **Display gap** (B-030a) — measured, not fixed
- **Cadence** — `--news-only` mode, 4 cron slots, cap 120

---

## 3. Verification status — be precise about this

| Check | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm test` | **738/738**, 32 files |
| `brief.spec.ts` + `news.spec.ts` | **99 passed**, 7 skipped |
| Session-cache test after B-031 fix | **12/12** |
| Mutation test on `matchTeams()` | test failed as required |
| Full e2e suite | **425 passed, 6 failed, 7 skipped** — all 6 are B-033 |
| Deploy on `6ef88b3` | **SUCCESS** — served build id `6ef88b3.1b5a14a`, verified by curl |
| CI on `6ef88b3` | **in progress at handoff time — NOT YET CONFIRMED** |

**The app code IS deployed.** The served document reports build
`6ef88b3.1b5a14a`, which is the commit pushed this session. So B-031 (the stale
search submit) and B-032 (the card layout) are live.

**CI is the only open question.** It was still running when this was written.
Check it first — if it is red, the remaining failures are almost certainly
B-033 (WebKit flakiness), which `retries: 1` normally absorbs.

---

## 4. First actions for the next session

```bash
cd "/home/lm/Dev/BKH pwa app"

# 1. Did CI go green? This is the whole point of the push.
gh run list --limit 5 --json databaseId,name,status,conclusion,headSha

# 2. If CI is red, read the failing job.
gh run view <run-id> --log-failed | tail -80

# 3. Confirm the deploy actually published the new build id.
curl -s https://danielomazarino.github.io/Min-BKH-app/ | grep -o 'data-build="[^"]*"'

# 4. Confirm the served data is still byte-identical to the committed data.
git show HEAD:public/data/app.json | sha256sum
curl -s https://danielomazarino.github.io/Min-BKH-app/data/app.json | sha256sum
```

Expected build id: `6ef88b3.<something>`. If it still reads `6971caa.1988cd3`,
the deploy did not publish and that is the thing to fix first.

---

## 5. Recommended order for the remaining work

| # | Item | Size | Why this order |
| --- | --- | --- | --- |
| 1 | Confirm CI/Deploy green on `6ef88b3` | 5 min | Nothing else matters if the push did not land |
| 2 | **Dead `dedupeKey`** (B-030b) | **S** — one line + tests | Unblocks multi-source events; makes B-029 verification cleaner |
| 3 | **B-029** Wikidata gate | **L** — 2–3 days | Must land **before** the display gap, or the false positive becomes visible |
| 4 | **Display gap** (B-030a) | **M** | Rebuild events from the accumulated `news` array |
| 5 | **Cadence** | **M–L** | Last: 4× the runs multiplies every bug above |
| — | B-033 WebKit flakiness | **M** | Independent; do it when CI noise becomes annoying |

### Why B-029 before the display gap

Today the Ohlsson false positive is **invisible** — it is in `news` but in no
event. Fixing the display gap first would make it visible. Fix the gate first.

### Why cadence is last

4× the runs means 4× the exposure to any bug in items 2–4.

---

## 6. Key facts to carry forward

### The display gap, measured on the served artifact

```
news: 41   newsEvents: 31   articles in news but in no event: 10
events with more than one source: 0
```

The 10 invisible articles include real Häcken stories: "Mikkel Rygaard lämnar
Häcken", "Häcken körde över Örgryte i derbyt – Lindberg hjälte", "Julius
Lindberg tvåmålsskytt när Häcken vann".

Two independent causes:

- **(a)** `run.ts` builds `newsEvents` from *this run's* candidates only, while
  `news` accumulates across runs. The app renders `newsEvents` (`News.tsx`,
  `Brief.tsx`), never `news`.
- **(b)** `pipeline/src/rss.ts` sets `dedupeKey: link` on every item, so
  `pipeline/src/dedupe.ts`'s `item.dedupeKey ?? key` **never fires**. Every
  article keeps its own URL as its event key → `buildNewsEvents` can never group
  two articles → **0 multi-source events**.

**Caveat for (a):** `run.ts` deletes `bodyText` from accumulated news after
events are built, so archived items have no body text. Any fix needing text from
an archived item must persist bodies (+2.3KB gzip measured) or merge the
previous run's events in.

**Out of scope:** true cross-run story merging is **unsolved** — best prototype
TP=16 / FN=6 / **FP=25**. Do not attempt it.

### B-029 ground truth (two Sebastian Ohlssons)

| | **Ours** | **The twin** |
| --- | --- | --- |
| QID | `Q17461659` | `Q16633334` |
| Born | 1992-12-31 | 1993-05-26 |
| BK Häcken | **2014–2015** | none |
| Position | mittfältare (`Q193592`) | anfallare / försvarare |
| Shirt | #7 | #16 |
| Fogis | 370608 | 367391 |
| TM | 205436 | 217357 |

**The original premise was inverted.** 1992 = former Häcken player; 1993 = no
Häcken background. Forza lineups for Degerfors 1–2 Kalmar (2026-10-19, match
`1219499965`): **#16 (b. 1993) started**; #7 was an unused substitute. The
quoted player is the twin.

**Solution:** a computed "shadow set" — one SPARQL `SELECT DISTINCT` self-join
on `rdfs:label`, restricted to `P106 = Q937857` (footballer) on the twin side.
Measured cost: footballer-twin variant = **0** genuine articles lost; all-human
variant = **5** lost (all Julius Lindberg). **The gate must be restricted to
footballer twins.**

**Non-negotiable:** failure must be **non-fatal** (empty set ⇒ no gate ⇒ old
behaviour); the gate belongs in **PASS 1** of `mentionsKnownPerson`
(`pipeline/src/newsRelevance.ts`); `SELECT DISTINCT` only (the `GROUP_CONCAT`
variant times out); `VALUES ?label { … }` binds only `?label`, so `?label` must
be selected explicitly.

### Cadence

Root cause of "missed news" is **when** the feed is sampled, not the filter.
Nightly samples once at 03:30 UTC; GP's "Rygaard om Häckens väntan" published
03:47:07 was missed by the 03:48 run. Tracked as **B-006 OPEN**.

Proposed: news-only runs (RSS + article text + relevance + accumulation; no
squad enrichment, no SportoMedia match detail) at 3 slots, full pipeline at
03:30 UTC. Raise cap 60 → 120. Add schedule copy + deploy guard.

Full run costs 93–97 API calls, ~215–270s wall time, constrained by Wikidata
politeness (~10 req/min) during squad enrichment.

---

## 7. The archived handoff is stale — do not trust it

`docs/archive/continuation-B-029-handoff-2026-10-22.md` is wrong in three
places:

| It says | Reality |
| --- | --- |
| repo clean at `4445006` | now `6ef88b3` |
| served sha `ffabcc71…`, build `4445006.83b59d0`, 36 news | `e3a3ac81…`, 41 news, 31 events |
| the Kalmar article is "still present in the served feed" | present in `news`, **absent from `newsEvents`** — i.e. invisible |

Its B-029 content (ground truth, the measured solution, the 7-step plan) is
still accurate and is now mirrored in `docs/ENHANCEMENTS.md` under **B-029**.

---

## 8. Repo rules that bit this session

- **Verify the served artifact, not the workflow status.** A green run proves
  generation, not publication.
- **A browser screenshot can lie.** The service worker caches `/data/*.json`
  with `NetworkFirst`, so a cached payload can render after a real deploy. Use
  `curl`. This is also why every hermetic e2e fixture must `unregister()` the
  worker and `caches.delete()` before `page.route` — otherwise the route gets
  **zero hits** and the test silently asserts against the real file.
- **Never edit `docs/archive/`.** It is a frozen record.
- **Do not run `npm run pipeline` for diagnosis** — it is the 12-request path.
- **`GITHUB_TOKEN` pushes do not trigger workflows.** `workflow_dispatch` is not
  suppressed and is the mechanism to chain a deploy.
- **Commit trailer:** `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
- **For iPhone testing, deployed is the only "done".** A local build is not
  delivery.

---

## 9. Session history

| Commit | What |
| --- | --- |
| `94aaf30` | docs: add continuation handoff for B-029 (homonym false positives) |
| `705ae4f` | data: nightly update 2026-10-21 |
| `6971caa` | data: nightly update 2026-10-22 |
| `6ef88b3` | **this session** — unrot two e2e fixtures, fix stale search submit, record B-029..B-033 |
