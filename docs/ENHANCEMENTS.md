# Min BKH-app — Enhancement Log

Running list of known issues, UX improvements and data/domain corrections.
Newest first. Each item states **what**, **why**, and **how to verify it is fixed**.

Status keys: `OPEN` · `IN PROGRESS` · `DONE` · `BLOCKED` · `NEEDS DECISION`

---

## 2026-09-26 — after UX rebuild `8f9b4d9` went live

### E-001 · Kortläget must show every qualifying player
`OPEN — regression`

The Kortläget count and rows must represent the same complete set of currently
qualifying BK Häcken men's players.

**Never cap the list with a fixed slice.**

**Acceptance**
- If 5 players qualify, the heading says 5 and all 5 are visible.
- If 0 qualify, the empty state is handled explicitly.
- Sorting must not cause an important player to disappear.

**Current cause.** `app/pages/Home.tsx` hard-codes the cap:

```ts
{suspended.slice(0, 2).map(...)}
{atRisk.slice(0, 3).map(...)}
```

`urgent.length` in the heading is not capped, so the number and the rows
disagree — that mismatch is the visible symptom.

Worse, `urgentDiscipline()` in `app/shared/format.ts` deliberately sorts
`at_risk` by *fewest pending warnings first* so the player closest to a
suspension is on top. Mikkel Rygaard Jensen (`at_risk`, 5 warnings) therefore
sorts **last** of the four at-risk players, and `slice(0, 3)` cuts exactly him.
The module is hiding its most important row.

**Regression?** Yes. The pre-`8f9b4d9` app rendered every flagged player with
no cap, so all 5 appeared.

**Verify.** `app.json` discipline has 5 entries with status `suspended_next` or
`at_risk` → the Brief shows 5 rows, the count matches, and Rygaard is among
them.

---

### E-002 · Group discipline states to reduce repetition
`OPEN — UX`

Group players under:

- **Avstängd nästa match**
- **En varning kvar**

Display each status label **once per group** rather than repeating it for every
player. The groups remain dynamic and contain every qualifying player.

**Why.** The repeated per-row label carries no per-player information — it is
identical for everyone in the same group. With 5+ players that is a lot of
repeated text for no information gain.

**Target shape**

```
AVSTÄNGD NÄSTA MATCH
  Abdoulaye Doumbia      ▮▮▮▮▮▮

EN VARNING KVAR
  Mikkel Rygaard Jensen  ▮▮▮▮▮
  Adrian Svanbäck        ▮▮
  Brice Wembangomo       ▮▮
```

Group headers replace the per-row label. The card pips stay per player since
they are per-player data. This layout is also the natural home for E-003.

**Verify.** No player row repeats a status string; each group header appears
exactly once; every qualifying player is present.

---

### E-003 · Current discipline risk must exclude departed players
`OPEN — data/domain`

A player who is **no longer a current BK Häcken men's player** must not appear
in current Kortläget suspension-risk calculations.

Historical cards remain valid historical data but must **not** create a current
future suspension warning.

**Example.** Amor Layouni's historical Häcken cards must not produce
"En varning kvar" after his departure. He was sold by BK Häcken to another club
and is no longer a Häcken player as of 2026-09-26.

**Current state**
- Absent from `squadStats` (SportoMedia squad has 27 players) — the source is
  already correct.
- Absent from `former-players.json` / `registry.json` — never registered as a
  former player.
- Still `at_risk` with 2 warnings in the discipline ledger, because the ledger
  spans the whole season including matches he played before the transfer.

**Why it matters.** "En varning kvar" implies a suspension in a competition
Häcken plays in. He cannot be suspended by Häcken — he no longer plays for the
club. A supporter reading the Brief is misinformed.

**Acceptance**
- Departed players never appear in the current Kortläget.
- Their historical cards remain in the season ledger.
- Search for them still returns them under Tidigare with transfer provenance.

---

### E-004 · Swipe-down to dismiss does not work on a real iPhone
`OPEN — bug (reported on device)`

**Reported 2026-09-26 on an iPhone.** Dragging a sheet downwards does nothing
anywhere in the app. The match sheet (last game) and the player detail sheet can
only be closed by pressing the X. This affects every `Sheet` in the app, because
they all share one component.

**Current cause.** `app/shared/Sheet.tsx` implements drag-to-dismiss with
pointer events bound to the grabber only:

```ts
<div className="sheet-grab" onPointerDown={onGrabDown} onPointerMove={...} onPointerUp={...} />
```

Two things make it effectively dead on touch:

1. **The drag target is 22px tall** (`.sheet-grab { height: 22px }`) with a 4px
   visible bar. Aiming at a 4px line on a 390px-wide sheet is not a gesture
   anyone performs.
2. **`.sheet` sets `touch-action: pan-y` while the body scrolls.** Safari
   treats a downward drag on the sheet body as page scroll intent and can claim
   the gesture before the element's pointer handlers see a usable move. Only the
   grabber has `touch-action: none`, so only the grabber *can* work — and it is
   the one place nobody tries.

There is also no regression test: nothing in `e2e/` or `app/` references
`sheet-grab`, so the gesture has never been exercised.

**Note.** The X, the backdrop, Escape and the iOS back gesture all still work, so
nothing is *unreachable* — this is a lost affordance, not a lockout. The
component's own contract already states the drag must never be the only way out,
so the fix must keep it additive.

**Fix direction (smallest first)**
1. Enlarge the grabber to a comfortable touch target (~44px) and widen the
   visual bar, so the affordance is discoverable.
2. Accept the drag from the sheet header as well as the grabber, which is where
   a thumb naturally lands.
3. Only if that is still unreliable on device: add a velocity check alongside the
   96px distance threshold, so a fast flick closes even if the finger barely
   moved.

**Acceptance**
- On a real iPhone, dragging the sheet down or flicking it down closes it, for
  the match sheet, the player sheet and the settings sheet.
- Dragging **up** does not close it and does not break body scrolling.
- The X, backdrop, Escape and back-gesture paths keep working unchanged.
- A test covers the drag, so this cannot silently regress again.

---

### E-005 · Discipline ledger must be scoped to current squad membership
`OPEN — pipeline/domain`

Current suspension-risk calculations must cross-check **current men's squad
membership**.

**Acceptance**
- Every player in the current at-risk output is currently in the men's squad.
- Departed players can remain in historical match/card data.
- Transfer/departure changes are reflected without manual UI filtering.

**Current cause.** `computeSeasonDiscipline()` in
`pipeline/src/discipline.ts` walks all 22 finished matches and keeps any player
who collected a card, regardless of current squad membership. The 18-entry
ledger includes departed players (Layouni, Helander, Thorup, Agbonifo, …),
mostly marked `served`.

The `served` entries are fine — they are historical and the UI already filters
them out. Only `at_risk` for a departed player is wrong, and that is E-003. E-004
is the mechanism that prevents it recurring for every future transfer.

**Verify.** Any `at_risk` player is present in `squadStats`.

---

### E-006 · Former-player search must not depend on the stale local registry
`OPEN — architecture/data`

The existing local former-player register (~28–30 entries) must **not** define
the universe of former Häcken players.

Former-player search is a **search/discovery feature**, not a directory of
manually pre-registered players.

The registry may be retained temporarily as seed/test data, but it must not be
the authoritative source.

**Current state.** `pipeline/src/registry.json` holds **31 entries** and is the
only universe of former players. `app/pages/FormerPlayers.tsx` reads
`former-players.json`, which is generated exclusively from that registry via
`loadRegistry()`. A Häcken player who has never been manually added is
**invisible** — search cannot find them because they do not exist in the data.

**Note.** The Tidigare screen currently shows "Bläddra · 28 spelare" with A–Z
browse, which presents the registry as a complete directory. That framing is
the problem this item addresses.

**Acceptance**
- A former Häcken player can be found even if absent from the local registry.
- Search results are based on a **documented** authoritative/discovery source.
- No arbitrary fixed list is presented to the user as "all former players".

---

### E-007 · Former-player identity and status must be time-aware
`OPEN — data model`

Distinguish:

- current BK Häcken men's player
- former BK Häcken player
- historical/previous Häcken player with incomplete current data
- unknown/unverified status

**Transfers must move a player out of current-team context without destroying
their historical Häcken relationship.** A transfer is a state change, not a
deletion.

**Acceptance.** A player's status can change over time without losing their
Häcken history, and the UI can state the current relationship honestly.

---

### E-008 · Former-player enrichment must discover identifiers
`OPEN — data pipeline`

Do not require an external identifier to already exist in a local registry.

The enrichment pipeline should be able to:

1. discover a candidate player,
2. verify the Häcken relationship,
3. resolve the appropriate external identifier,
4. enrich current club/career data,
5. retain provenance and verification date.

**Current state.** `collectFormerPlayers()` in `pipeline/src/run.ts` gates
API-Football enrichment on `entry.apiFootballId && process.env.API_FOOTBALL_KEY
&& STATUS.apiFootball === "ok"`. Because discovery is manual, the enrichment
branch is effectively dead: **0 of 31** registry entries have an
`apiFootballId`, and **0 of 31** have a `fogisId`. The API-Football integration
therefore enriches nothing at all.

**Acceptance.** Identifier resolution happens as part of discovery, not as a
manual prerequisite.

---

### E-009 · Former-player facts require provenance
`OPEN — data quality`

Current club, statistics, contract and transfer information must retain
**source/provenance and verification date**.

**Unknown information must remain unknown rather than being inferred or filled
with stale data.**

**Current state.** The Tidigare detail sheet already renders this honestly —
"Ingen verifierad klubbuppgift finns just nu", "Ingen verifierad
säsongstatistik finns just nu", "Kontraktsläget är inte verifierat" — and
shows the Wikipedia source link for career text. This item exists to make it a
**rule**, not just current behaviour, so a future data source cannot silently
fill gaps with guesses.

**Acceptance.** Every populated fact traces to a source and a date; gaps stay
empty.

---

## Former-player search coverage audit — 2026-09-26

`AUDIT — read-only, no implementation`

Follows directly from the section above. That section proved Wikidata and
TheSportsDB *can* find players and *can* be called from the browser. It did not
answer the product question: **is coverage good enough for a supporter who has
followed BK Häcken for ~30 years?** This audit measures that.

### Purpose and product requirement

Measure whether an **arbitrary name search** (never "name + BK Häcken") can
return *"this appears to be the footballer you mean"* for players spanning
three decades, **including when the Häcken connection cannot be proven.**

Discovery of the *person* is the metric. Proof of the Häcken appearance is
explicitly **not** the metric, and a missing Häcken link must not suppress a
result.

### How the sample was established (independently of the audited sources)

**VERIFIED.** The population was drawn from sources that are *neither* Wikidata
nor TheSportsDB, so the audit is not circular:

- `sv.wikipedia.org` → article `BK Häcken` → section **"Noterbare spelare"**
  (29 names), fetched via `action=parse&prop=wikitext&origin=*`.
- `pipeline/src/registry.json` (the existing long-tail list) for the
  ordinary/short-spell tail that the Wikipedia list omits.

No player was selected because Wikidata or TheSportsDB already lists them.

**Final sample: 30 players** — 1990s: 6 · 2000s: 7 · 2010s: 11 ·
2010s–20s: 6. Intentionally included non-Swedish players, players who left
football early, single-name players, common Swedish names, and diacritics.
Plus **3 control cases** (below).

### Method

Each name queried **independently** against both sources, `BK Häcken` never
included in the query. Requests paced ~1.2 s apart to stay under the observed
limit; `429` was retried per `Retry-After` and recorded as `RATE-LIMITED`,
never as `NOT-FOUND`.

### Coverage table

`FOUND-CORRECT` = correct footballer identified. IDs are Wikidata Q-IDs /
TheSportsDB player IDs.

| Player | Era | Profile | Wikidata | TheSportsDB |
|---|---|---|---|---|
| Hasse Berggren | 1990s | ordinary | FOUND-CORRECT (Q280957) | NOT-FOUND |
| Peter Eriksson | 1990s | ordinary | FOUND-CORRECT (Q552362) | NOT-FOUND |
| Arnor Gudjohnsen | 1990s | non-Swedish, short spell | FOUND-CORRECT (Q557163) | FOUND-CORRECT |
| Dulee Johnson | 1990s | non-Swedish, left football early | FOUND-CORRECT (Q972133) | NOT-FOUND |
| Teddy Lucic | 1990s | older, non-famous | FOUND-CORRECT (Q314756) | NOT-FOUND |
| Kim Källström | 1990s | established | FOUND-CORRECT (Q214124) | FOUND-CORRECT |
| Tobias Hysén | 2000s | established, non-Swedish | FOUND-CORRECT (Q313036) | FOUND-CORRECT |
| Diego Lugano | 2000s | established, very short spell | FOUND-CORRECT (Q373547) | FOUND-CORRECT |
| John Chibuike | 2000s | non-Swedish, left football early | FOUND-CORRECT (Q619169) | FOUND-CORRECT |
| Rasmus Lindgren | 2000s | established | FOUND-CORRECT (Q440904) | FOUND-CORRECT |
| Paulinho | 2000s | single-name, ambiguity risk | FOUND-CORRECT (Q73082) | FOUND-CORRECT |
| Jonny Rödlund | 2000s | non-famous, diacritics | FOUND-CORRECT (Q1703466) | NOT-FOUND |
| Jonas Henriksson | 2000s | non-famous | FOUND-CORRECT (Q1566038) | NOT-FOUND |
| Waris Majeed | 2010s | non-Swedish, short spell | FOUND-CORRECT (Q317347) | FOUND-CORRECT |
| Mathias Ranégie | 2010s | established, diacritics | FOUND-CORRECT (Q703994) | FOUND-CORRECT |
| Joakim Söndergaard | 2010s | non-famous, diacritics | FOUND-CORRECT (Q6202489) | NOT-FOUND |
| Alexander Farnerud | 2010s | established | FOUND-CORRECT (Q1341836) | FOUND-CORRECT |
| Andreas Landgren | 2010s | ordinary | FOUND-CORRECT (Q499225) | NOT-FOUND |
| Dominic Chatto | 2010s | non-Swedish, ordinary | FOUND-CORRECT (Q4348122) | NOT-FOUND |
| Martin Ericsson | 2010s | ordinary, long tail | FOUND-CORRECT (Q602051) | NOT-FOUND |
| Emil Krafth | 2010s | long tail, poor documentation | FOUND-CORRECT (Q5371332) | FOUND-CORRECT |
| Alexander Jeremejeff | 2010s–20s | ordinary | FOUND-CORRECT (Q16633101) | FOUND-CORRECT |
| Mikkel Rygaard | 2010s–20s | ordinary, alias risk | FOUND-CORRECT (Q27473659) | FOUND-CORRECT |
| Darijan Bojanic | 2010s–20s | non-Swedish, diacritics | FOUND-CORRECT (Q5580980) | FOUND-CORRECT |
| Paulo Victor | 2010s–20s | common-ish first name | FOUND-CORRECT (Q7155323) | FOUND-CORRECT |
| Ahmed Yasin | 2010s–20s | non-Swedish | FOUND-CORRECT (Q165866) | FOUND-CORRECT |
| Oscar Lewicki | 2010s–20s | common Swedish name | FOUND-CORRECT (Q431669) | FOUND-CORRECT |
| Erik Friberg | 2010s | ordinary | FOUND-CORRECT (Q1353941) | FOUND-CORRECT |
| Jesper Karlstrom | 2010s | long tail, diacritics | FOUND-CORRECT (Q16633144) | FOUND-CORRECT |
| **Kenneth Mattsson** | 2010s | common surname | **NOT-FOUND** | **NOT-FOUND** |

### Combined coverage (raw counts)

| Metric | Count | % |
|---|---|---|
| **Wikidata** found correct | **29 / 30** | 96.7% |
| **TheSportsDB** found correct | **18 / 30** | 60.0% |
| **Combined (either source)** | **29 / 30** | **96.7%** |
| Found by both | 18 | 60.0% |
| Found by **Wikidata only** | 11 | 36.7% |
| Found by **TheSportsDB only** | 0 | 0% |
| Found by neither | 1 | 3.3% |
| Ambiguous / wrong-identity | 0 | 0% |
| Rate-limited or not tested | 0 | 0% |

**Wikidata is doing essentially all the work.** TheSportsDB is a subset
(18/30) and added **zero** unique finds in this sample — it is a confirmation
and cross-check source, not a coverage extension. That contradicts the earlier
section's note that the two are "complementary"; on this population Wikidata
strictly dominates. *(Earlier observation that they differ still holds — a
pre-audit probe found Gustav Lindgren in TheSportsDB only — but on a 30-player
Häcken population that gap did not materialise.)*

### Difficult cases

| Case | Query | Result | Consequence |
|---|---|---|---|
| **C** common name | `Magnus Andersson` | 6 candidates across 2 sports/professions → **disambiguation UI required** | Never auto-select the first hit |
| **D** diacritics | `Kim Källström`, `Tobias Hysén`, `Darijan Bojanic` | all FOUND-CORRECT | Diacritics work **when supplied** |
| **E** diacritics stripped | `Frolund` (for Frölund) | **NOT-FOUND in both** | ⚠️ Supporters typing ASCII will fail |
| **G** misspelling | `Warish Majeed` | **NOT-FOUND in both** | ⚠️ Spelling tolerance needed |
| **F** false-positive control | `Magnus Andersson` (real footballer, **not** a Häcken player) | FOUND-CORRECT in Wikidata | Confirms discovery does not require Häcken — and that a real non-Häcken player **is** returned, which is correct per the player-first rule |
| **A** obscure older | `Dulee Johnson`, `Teddy Lucic` | both FOUND-CORRECT | Encouraging for the long tail |
| **B** few appearances | `Emil Krafth` | FOUND-CORRECT in both | Good |
| — Icelandic spelling | `Arnor Gudjohnsen` → `Arnór Guðjohnsen` | FOUND in both | Requires non-Latin/eth-aware matching |

### The one real failure

**Kenneth Mattsson** — not found in either source.

- `Kenneth Mattsson`, `Kenneth Mattsson fotboll`,
  `Kenneth Mattsson svensk fotboll` → **0 results** in both.
- `Ken Mattsson` → returns Wikidata `Q103270461`, but on inspection it has
  **no date of birth and 0 clubs** — an unrelated stub, not our player.
- **Category: source coverage gap.** This player has no entity in either
  source. Note he is a genuine long-tail case (common surname, 2010s).

### Identity resolution

| Metric | Count |
|---|---|
| Found players with a **stable Wikidata Q-ID** | **29 / 30** |
| Found players with a **TheSportsDB player ID** | 18 / 30 |
| Found players with **any** stable ID | **29 / 30 (96.7%)** |

**VERIFIED:** a found player essentially always has a Q-ID usable for
subsequent enrichment. This is the property the two-stage architecture needs —
name → stable ID → enrichment — and it holds for every found player.

Caveat: an ID existing does **not** imply complete statistics. Several
entities carry thin `P54` data (e.g. no qualifiers), so "current club" may
still be unknown.

### Rate-limit observations

- **No burst was deliberately triggered.** Pacing kept the run clean: **0
  rate-limited results** in 66 requests.
- The earlier measurement stands: **~10 requests/minute**, `429` with
  `Retry-After`. A naïve per-keystroke search would hit this almost
  immediately — and a `429` would look identical to "player not found" to a
  supporter unless handled explicitly.
- **Rate limits are per source, not global.** Wikidata and TheSportsDB
  throttle independently.
- **Gemini cost of this entire feature: 0 requests.** Discovery is
  source-driven; Gemini is not in the path.

### Conclusion

**A. SUFFICIENT FOR NEXT-STAGE PROTOTYPING**

**The evidence:** 29/30 (96.7%) of former Häcken players across 1990s→today were
found by **name alone**, including long-tail cases (Emil Krafth, Andreas
Landgren, Martin Ericsson, Jesper Karlstrom), non-Swedish players, players who
left football early, and players with very short spells. 29/29 found players
carry a stable ID for enrichment. 96.7% of found players were discoverable
**without any Häcken evidence being required**, which is exactly the product
rule.

**Why not B:** the one gap (1/30) is a genuine coverage hole, but it does not
justify a third source yet. The most likely remedy — diacritic-insensitive
and spelling-tolerant matching — is a *matching* problem, not a *source*
problem, and is cheaper and more reliable than adding a provider.

**Why not C:** a 3.3% miss rate on a deliberately long-tail sample is not
"too poor" for a lookup convenience feature, especially when the UX can
truthfully say *"no online record found — try a different spelling"*.

**Known gaps to carry into design, not blockers:**

1. **Diacritic-insensitive input fails** (`Frolund` → nothing). Must be fixed
   client-side by normalising input.
2. **No spelling tolerance.** `Warish Majeed` → nothing. Fuzzy matching is
   required for realistic recall.
3. **Disambiguation is mandatory** — common names return many candidates.
4. **TheSportsDB adds no unique coverage** on this population; do not build
   the architecture as if two sources are equally needed.
5. **Coverage gap exists and is real** — assume some obscure players will not
   be findable, and design honest "not found online" UX.
6. Non-Latin spellings (eth, thorn, accents) need Unicode-aware matching.

### Recommended next step

**Proceed to design the search UX and enrichment flow.** The evidence supports
it. Design requirements to carry in:

- Search on **submit or deliberate debounce** — never per keystroke
  (rate limit).
- **Session cache** repeated identical queries.
- **Normalise input** diacritic-insensitively; add **fuzzy/spelling-tolerant**
  matching; handle non-Latin letters.
- Always show **candidates**, never auto-select.
- Treat **429 as "search failed", never as "player not found"** — and say so
  to the supporter.
- Häcken relationship is a **separate, optional enrichment** with its own
  `verified / uncertain / not found / unknown` states.
- Cost: **0 Gemini requests** for supporter searches.

**Then, before implementation:** confirm whether the 1/30 gap is worth a third
source. That is a cheap, bounded follow-up — and it is a question for
*implementation*, not for this audit.



`INVESTIGATION — read-only, no implementation`

This is part of the ongoing Gemini/API work (see B-001 and the quota findings
below). It is **not** a new track. No code was changed; this section records
durable evidence so the reasoning survives this conversation.

### Why this was investigated

E-006/E-007/E-008 all assume a *curated registry* of 31 former players. That
assumption came from an earlier design and is now known to be wrong for this
product. This section records what online sources can and cannot do, and what
the correct product shape is.

### The corrected product requirement

**Player-first discovery, not Häcken-first discovery.**

The supporter has followed the club ~30 years and wants to look up *any* player
they remember — including one-appearance subs, lower-division spells, players
from the 1990s, players with poorly documented online records, and players
whose Häcken connection cannot be proven from any source.

The wrong model (explicitly rejected):

```
name -> search "<name> + BK Häcken" -> require proof -> reject if unproven
```

The correct model:

```
name -> online player search -> candidate(s) -> identity resolution
     -> player profile -> OPTIONAL Häcken enrichment -> display
```

**Failure to establish the Häcken connection must NOT block discovery.** The
Häcken relationship is an *enrichment layer* with its own states — `verified`,
`uncertain`, `not found`, `unknown` — not a gate.

**No application-wide player index is wanted.** No master list, no historical
Häcken database, no static registry embedded in the app, no nightly job
researching every former player. Online search is preferred. The only
eventual cache is user-selected: favourites and recent searches.

2010 is an example year from the investigation, **not** a historical boundary.

### Gemini conclusions that constrain this design

From the same investigation, and binding on any former-player design:

- **VERIFIED** — Gemini 3.x Google Search Grounding is **"Not available"** on
  the Free Tier. Google's pricing page shows this per model (3.8/3.7/3.6/3.5
  Flash all "Not available"; only Gemini 2.5 Flash/Flash-Lite get *free*
  grounding at 500 RPD, and **our key cannot access 2.5-flash at all** — it
  returns 404 "no longer available to new users"). See
  <https://ai.google.dev/gemini-api/docs/pricing>.
- **VERIFIED** — Gemini 3.8 Flash *inference* is free of charge on the Free
  Tier (subject to 5 RPM / 250K TPM / 20 RPD, reset midnight Pacific).
- Therefore **Gemini cannot do web research for us.** `geminiResearch.ts`
  currently declares `tools: [{ google_search: {} }]`, which cannot succeed
  under the free-tier constraint. It is viable only as a **processor of data we
  already retrieved**.
- **Consequence:** Gemini is **not** responsible for player discovery. It is at
  most useful for disambiguating candidates, normalising heterogeneous claims,
  and writing a concise Swedish summary from already-retrieved facts.

### Sources tested

All probes were GET-only, no keys, no scraping, from the real deployed origin
`https://danielomazarino.github.io`.

| Source | URL | Browser CORS | Auth | Result |
|---|---|---|---|---|
| Wikidata entity search | `https://www.wikidata.org/w/api.php?action=wbsearchentities` | **WORKS — but only with `&origin=*`** | none | ✅ best candidate |
| Wikidata claims | `https://www.wikidata.org/w/api.php?action=wbgetclaims` | works with `&origin=*` | none | ✅ |
| Wikidata SPARQL | `https://query.wikidata.org/sparql` | ✅ `ACAO: *` | none | ✅ (enrichment, not search) |
| Wikipedia search (en/sv) | `https://{en,sv}.wikipedia.org/w/api.php?action=query&list=search` | works **only** with `&origin=*` | none | ✅ secondary |
| TheSportsDB v1 | `https://www.thesportsdb.com/api/v1/json/3/searchplayers.php` | ✅ `ACAO: *` | key `3` is public/free tier | ✅ good second source |
| SportScore | `https://www.sportscore.com` | **403** | — | ❌ |
| `api.sportscore.com` | — | **HTTP 520** | — | ❌ |
| worldfootball.net | `https://www.worldfootball.net/player_summary/…` | **403** | — | ❌ blocks bots |
| Transfermarkt | `https://www.transfermarkt.com/schnellsuche/…` | **403** | — | ❌ scraping violates ToS |
| openfootball | `https://github.com/openfootball/football.json` | ✅ `ACAO: *` | none | ❌ see below |

#### SportScore claims do not hold

The candidate brief described SportScore as browser/CORS accessible, no key
for its open tier, with historical fixtures and generous allowance. **None of
that was verifiable.** `www.sportscore.com` returned **301**, the API host
returned **520**, and the guessed public API path returned **403** with no
`Access-Control-Allow-Origin`. Treat as unverified/unusable without a direct
vendor conversation.

#### openfootball is not a player registry

**OBSERVED:** the repo has season directories from 2010-11 onward, but
**`2015-16` contains 0 files matching `se.*`** and `se.1.json` does not resolve.
The data it does ship is fixtures, and **no `squad`/`lineup` player data** was
found in the payloads inspected. It is not a player-discovery source and must
not be turned into an embedded index.

#### The CORS trap that will bite the implementer

**VERIFIED** — the MediaWiki action API sends **no** `Access-Control-Allow-Origin`
header on an ordinary cross-origin GET. In a real browser, from the deployed
origin:

```
https://www.wikidata.org/w/api.php?...&format=json          -> TypeError: Failed to fetch
https://www.wikidata.org/w/api.php?...&format=json&origin=* -> 200 OK
```

`&origin=*` is **mandatory** on every MediaWiki call. This is easy to miss
because the endpoint returns 200 to `curl` and to server-side code — it only
fails in the browser. Wikibase's own `origin` parameter is what enables this.

### Rate limits (VERIFIED — this is the binding constraint)

**Wikidata rate-limits hard.** A burst of 25 identical requests from one
client:

```
1..10  -> 200
11..25 -> 429, with `Retry-After: 55` (decrementing)
```

So roughly **10 requests/minute** before 429, with a server-supplied
`Retry-After`. **OBSERVED:** this also applies to browser-origin requests. An
earlier probe run produced *different results for identical queries* purely
because some requests 429'd; the apparent inconsistency was the rate limiter,
not Wikidata. Any client must therefore:

- debounce keystrokes (never search per keystroke),
- serialise requests,
- honour `Retry-After`,
- and treat a 429 as "retry shortly", never as "player not found".

**This is a design constraint, not an optimisation.** A naive
"search on every character typed" feature will be rate-limited almost
immediately.

TheSportsDB v1 free key `3` limits were not measured (UNTESTED).

### Test-player results

Representative set, chosen to include famous, ordinary, older, obscure,
common-name, diacritic and Häcken-absent cases. All via **arbitrary name
search** — no Häcken term in any query.

| Search string | Found | Candidate | QID | Häcken in P54 | Notes |
|---|---|---|---|---|---|
| Anton Hysén | yes | Anton Hysén (svensk fotbollsspelare) | Q590433 | **YES** | 5 clubs |
| Tobias Sana | yes | Tobias Sana | Q128859 | **YES** | 12 clubs; current Örgryte IS (2024) |
| David Frölund | yes | David Frölund | Q727444 | **YES** | diacritics + name change (Marek) |
| Björn Anklev | yes | Björn Anklev | Q360698 | **YES** | 90s/00s, diacritics |
| Waris Majeed | yes | Waris Majeed (ghanansk fotbollsspelare) | Q317347 | **YES** | 6 clubs incl. Häcken 2010 |
| Johan Sjöberg | yes | Johan Sjöberg (svensk fotbollsspelare) | Q945416 | no | 0 clubs — **returned anyway** |
| Emil Krafth | yes | Emil Krafth (svensk fotbollsspelare) | Q5371332 | no | 8 clubs — **returned anyway** |
| Magnus Andersson | yes | 6 candidates incl. footballer | Q1371342 | no | **disambiguation required** — also handballer, musician, others |
| Ingemar Björklund | **no** | — | — | — | no Wikidata entity; name used as a control |
| Warish Majeed (misspelled) | no | — | — | — | misspelling fails; spelling tolerance untested |

**Key observations.**

- **7/8 real players were found by name alone.** Discovery does not require a
  Häcken link.
- **Two players were returned with NO Häcken evidence** (Johan Sjöberg, Emil
  Krafth) — this is exactly the required behaviour. The Häcken check is
  independent of the search.
- **Diacritics work** when supplied (`Frölund`, `Anklev`, `Hysén` all
  resolved). Diacritic-*insensitive* input (`Frolund`) was **NOT TESTED**.
- **Disambiguation is real and required.** "Magnus Andersson" returns 6
  candidates across multiple sports and professions. A single-candidate
  assumption would be wrong.
- **Coverage is the genuine risk.** Wikidata is not complete. "Ingemar
  Björklund" — a plausible Swedish football name — has no entity. For a
  supporter's obscure 1997 sub, the primary source may simply be empty.
- TheSportsDB independently found Gustav Lindgren (@Häcken) and **Emil Krafth
  (@_Free Agent Soccer)** while returning 0 for Björn Anklev — i.e. it covers
*different* players than Wikidata on that small sample.
**REVISED 2026-09-26 by the coverage audit below:** on a 30-player former-Häcken
population, Wikidata found **29/30** and TheSportsDB **18/30**, with
**zero** unique TheSportsDB finds. Treat Wikidata as the primary source and
TheSportsDB as a cross-check, not as an equal second index.

### What worked / failed / uncertain

**Worked.** Wikidata name search + `P54` club claims, via `&origin=*`, from the
browser, with no key and no secret. Wikipedia search as a fallback. TheSportsDB
as a second opinion. Häcken is verifiable as `Q639723` in `P54`.

**Failed.** SportScore (all claims unverified; 403/520). worldfootball.net
(403). Transfermarkt (403; ToS). openfootball (no Swedish seasons, no player
data). Un-spelled / misspelled names.

**Uncertain.** Diacritic-insensitive input. TheSportsDB's real free-tier limit.
How often Wikidata misses a genuinely obscure Swedish pro. Whether Wikidata
`P54` statements carry start/end qualifiers reliably enough to show a
"current club" rather than a career list. Whether SvFF/Fogis IDs are present
on Wikidata entities (UNTESTED — the property exists but coverage was not
measured).

### Architectural implications

- **No backend is required.** Wikidata and TheSportsDB are CORS-open, so the
  search can run entirely in the browser. This preserves "no public backend"
  and keeps all secrets out of the client.
- **No secret is required or acceptable in the browser.** Any API needing a
  server-side key must be precomputed in Actions, not called client-side.
- **Wikidata is an identity/enrichment source, not a guaranteed registry.** It
  must not be the sole search path, and SPARQL regex/fuzzy matching must not be
  used as the primary name-search mechanism.
- **Identity resolution is a required step, not an optimisation.** Multiple
  candidates are the normal case.
- **Häcken enrichment is optional and separate** from discovery, with explicit
  `verified / uncertain / not found / unknown` states.
- **Quota impact of this model is negligible.** A supporter-driven search costs
  0 Gemini requests. Only precomputation in Actions would use Gemini, and a
  single daily news call already consumes 1 of 20 RPD.

### Recommendation for the next step

**NEEDS DECISION — do not build a player index, and do not wire Gemini into
discovery.**

Next step should be a **read-only coverage audit**: take ~20–30 real Häcken
players spanning 1990s → today, including known obscure ones, and measure how
many Wikidata and TheSportsDB each find. That answers the one open question
that decides the design — *is combined coverage good enough for a supporter's
memory of an obscure player?* — and it needs no Gemini, no code, and no keys.

If coverage proves thin, the fallback is a second free source plus explicit
"Not found online" UX, **not** a compiled index and **not** paid search
grounding.



### B-001 · Gemini semantic news processing
`BLOCKED — external service (revised 2026-09-26)`

**Original symptom.** Gemini 3.8 Flash returned `HTTP 503 UNAVAILABLE "high
demand"`. The key authenticates correctly (`listModels` → HTTP 200).

**What is now known (VERIFIED).** The 503s were a *different* problem from the
current blocker, and the picture has changed:

- A later run **did reach Gemini 3.8 Flash successfully** (HTTP 200) — it
  returned a valid but unusable response (0 usable events). So 503 is
  intermittent capacity, not a hard block.
- The current blocker is **quota**: the Free Tier allows **20 requests/day** for
  Gemini 3.8 Flash (5 RPM, 250K TPM, reset midnight Pacific). A former-player
  probe issued **84 requests in one run** (7 players × 4 models × 3 attempts)
  and exhausted the day. That was a design flaw in the probe, not a free-tier
  limit.
- **A quota-exhaustion guard has since been added** (`QUOTA_EXHAUSTED`): a 429
  reporting exhausted quota/billing now stops after **1** call instead of
  retrying across all models.
- **New and more important constraint:** Gemini 3.x Google Search Grounding is
  **"Not available" on the Free Tier** (per Google's own pricing page). Only
  Gemini 2.5 Flash/Flash-Lite offer free grounding, and our key cannot access
  2.5-flash (404). **So Gemini cannot perform web research for us while we
  remain free-tier-only.** See the former-player search section above.

**Keep the deterministic fallback operational.** It is intact and the live
news feed is currently served by it.

**Consequence while blocked.** Single-source news cards; the Gustav Lindgren
reports are not merged into one event. Multi-source synthesis is also
data-limited — see B-003, since external feeds currently contain **zero**
Häcken coverage.

**Do not** design around paid Search Grounding unless the free-tier constraint
is explicitly lifted by decision.

---

## Pipeline

### B-002 · News image extraction
`OPEN — independent`

Investigate extracting an article's `og:image` when RSS enclosure data is
missing, using the existing article-fetching pipeline
(`pipeline/src/articleText.ts` already fetches each page).

**Current state.** News card image slots render as empty gradient placeholders.
RSS only fills `imageUrl` from `<enclosure>` tags and the BK Häcken feed
provides none. Pre-existing — the old News UI had no images either.

**Acceptance.** News cards show real photos; a card with no image still renders
cleanly. No new dependency required.

---

### B-003 · Multi-source news discovery/event synthesis
`OPEN — data pipeline`

Current live data is still **12/12 single-source BK Häcken events**. The UI
fully supports multi-source events — `NewsEvent.sources[]` with pills, and
`summaryMethod: "gemini-synthesis"` — but the data pipeline does not yet provide
them consistently.

**Dependency.** Blocked on B-001. The deterministic path groups only articles
with identical normalised titles within ±3 days, which almost never merges
differently-worded reports of the same event.

**Acceptance.** Multi-source events appear in `app.json` with every original
source URL, publisher, title and date preserved.

---

## Notes for whoever picks this up

- `urgentDiscipline()` in `app/shared/format.ts` is the single source of truth
  for who appears in Kortläget. Keep its sort order — closest-to-suspension
  first — but never cap its output (E-001).
- `PlayerDiscipline.status` values in use: `suspended_next`, `at_risk`,
  `served`, `none`. `red_suspended` and `unknown` also exist in the type.
- The current suspension rule is 3 warnings in different matches = 1 match
  suspension, sourced from SvFF's 2026 competition regulations. It is rendered
  verbatim on the Brief from `disciplineRule` in `app.json`
  (`threshold` + `ruleSource`), so the text lives in the pipeline, not the UI.
- `registry.json` has 31 entries and **no** external identifiers at all. Any
  work on E-006/E-008 starts from that fact. **However** — do not treat this
  registry as the product shape. E-006/E-007 assume a curated list, which the
  2026-09-26 former-player search investigation concluded is the wrong model;
  that section replaces the list-based assumption with online player-first
  discovery. Read it before starting former-player work.
- **Former-player searches must be player-first, not Häcken-first.** A player
  who cannot be proven to have played for Häcken must still be returned, with
  the Häcken link reported as `verified / uncertain / not found / unknown`.
  The 2026-09-26 coverage audit measured **29/30 (96.7%)** coverage for this
  rule — see the audit section before starting former-player work.
- **Search must not fire on every keystroke.** Wikidata allows only ~10
  requests/minute and returns 429 with `Retry-After`. Search on submit or a
  deliberate debounce, session-cache repeats, and **never render a 429 as
  "player not found"**.
- **Input must be normalised diacritic-insensitively and matched fuzzily.**
  Verified: `Frolund` and `Warish Majeed` (misspelled) both return **nothing**,
  while `Frölund` returns the right player. Handle non-Latin letters
  (eth/thorn) too.
- **Always present candidates; never auto-select.** `Magnus Andersson` returns
  6 candidates across two sports.
- **Wikidata is the primary source, not one of two equals.** Coverage audit:
  Wikidata 29/30, TheSportsDB 18/30, TheSportsDB unique finds 0.
- **Coverage gaps are real.** One long-tail player (Kenneth Mattsson) is in
  neither source. Design honest "not found online" UX rather than assuming
  every former player is findable.
- **MediaWiki/Wikidata calls from the browser require `&origin=*`.** Without it
  the request fails in the browser (but still succeeds under `curl` and in
  Actions) — a very easy bug to ship unnoticed.
- **Wikidata rate-limits to ~10 requests/minute per client** and returns 429
  with `Retry-After`. Debounce input, serialise requests, and never treat a 429
  as "player not found". Early probes produced contradictory results purely
  because of this.
- **Gemini free-tier ceiling is 20 requests/day (5 RPM, 250K TPM),** reset
  midnight Pacific. Any batch loop that can multiply one logical operation
  across models × retries will exhaust it. A supporter-driven search model
  costs 0 Gemini requests.
- **Gemini 3.x Search Grounding is unavailable on the Free Tier.** Do not build
  any feature that depends on it while the free-tier constraint stands.
- All detail surfaces in the app are the same `app/shared/Sheet.tsx`. Fixing
  E-4 once fixes the match sheet, the player sheet, the settings sheet and any
  future sheet — but verify on a real iPhone, not just in an emulator, because
  the original miss was exactly that.
- **Suggested order.** E-002 first — the grouped layout is what E-001 and E-003
  both slot into, so fixing the cap and the departed-player handling can happen
  in one pass through the same component. E-005 follows once E-003 is decided.
  E-004 is independent and is the only bug a supporter can hit right now. B-002
  is independent and safe whenever.
- After changing anything under `app/` or `pipeline/`, verify on the **live
  GitHub Pages site in a fresh browser context**. The PWA service worker
  (`registerType: "autoUpdate"`) will serve the previous release and make a
  successful deploy look like a failure.
