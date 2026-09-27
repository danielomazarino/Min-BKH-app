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

---

## Player-first Spelare — implementation record (2026-09-26)

The investigation above concluded that the 31-player registry was the wrong
product model. This section records what was actually built, and — more
importantly — the measurements that changed the design along the way.

### What replaced the registry

`app/players/playerSearch.ts` (no I/O, pure matching) and
`app/players/wikidata.ts` (network) replace `pipeline/src/registry.ts`,
`registry.json`, `former-players.json`, `collectFormerPlayers*()`,
`writeFormerIfBetter()`, `loadFormerPlayers()` and the whole `FormerPlayer*`
type family. `search.ts` keeps `normalizeSearch` and loses `searchPlayers`.

The Spelare page now searches live. **No Häcken connection is required before
a player can be found** — the Häcken link is enrichment shown on the result,
never a filter. Gating on it would reproduce the closed list in a new costume.

### Measured facts that changed the design

| Question | Measurement | Consequence |
|---|---|---|
| SPARQL for name search | **57 s**; targeted P734 variant **45 s timeout** | SPARQL is unusable from a browser. Indexed `wbsearchentities` only (~1–2 s). |
| CORS | `origin=*` required, else browser `TypeError: Failed to fetch` while curl returns 200 | Invisible to server-side tests; asserted in the URL builder and re-checked in a real browser. |
| User-Agent | node `fetch` **without** UA → hard 429; with UA → 200 | Mandatory. Browsers forbid setting it, so the browser path relies on the browser's own UA. |
| Surname search | `"Jeremejeff"` returns **only** the surname entity `Q47466482`; the player `Q16633101` exists via P734 | Added a backlinks fallback, used only when the normal path finds zero people, so the common case still costs 2 requests. |

### Four real bugs, all caught by tests or live runs

1. **`const A_PERSON = 5`** — Q-IDs are `"Q5"`, not `5`. This made `isPerson()`
   always false, so **every single search returned not-found**. A live run
   caught it; a mocked test never would have.
2. **Ranking demoted footballers.** Sorting final candidates by `matchScore`
   put five non-footballers named "David Marek" above David Frölund `Q727444`,
   who is the actual former Häcken player. `rankCandidates` now returns the
   final `ordered` list and callers must not re-sort.
3. **Aliases were not scored.** A player found by a former name scored 0,
   because only the display label was compared. Aliases now count for matching
   but never for display.
4. **Query variants were one-sided.** Only the *candidate* was expanded, so
   `"A. Jeremejeff"` never matched "Alexander Jeremejeff". Both sides are now
   expanded.

### Product rules encoded in the UI

- **Six honest result states.** `idle | searching | results | not-found |
  rate-limited | failed`. A 429 means *we did not look* and says so in words;
  it is never rendered as "no such player".
- **Häcken is three-valued**: men's / women's / not recorded. "Not recorded"
  states that missing data is not a denial — Bjärsmyr has ten P54 clubs and
  BK Häcken is not among them, which is *absence of evidence*, not evidence of
  absence.
- **Status is never inferred.** Wikidata does not record active/retired, so
  the sheet says exactly that. No "pensionerad", no "fri agent".
- **Identity is the Q-ID**, never the name. Favourites key on it, so they work
  for any player found by search.
- **Submit-driven search, never per keystroke**, with a 5-minute in-memory
  session cache (40 entries) so repeated and back-spaced searches do not burn
  Wikidata's ~10 requests/minute budget. Transient failures are never cached.

### The e2e trap worth remembering

`page.route` and `context.route` **do not intercept** these cross-origin
`fetch` calls — measured, handler invoked 0 times, request reached the real
network; `serviceWorkers: "block"` did not help. The first draft of
`e2e/former-players.spec.ts` therefore looked green while quietly hitting the
live Wikidata API, and its "429" and "no results" cases failed because the
real API answered them.

The fix is `addInitScript` replacing `window.fetch`. **The stub must delegate
non-Wikidata requests to the real fetch** — an all-answering stub broke app
boot with `Cannot read properties of undefined (reading 'generatedAt')`,
because `data/app.json` was being faked as `{}`.

### Wikidata is discovery, not an authoritative registry

Coverage is uneven and that is stated in the UI, not hidden. Häcken links are
enrichment. TheSportsDB cross-checking is **not implemented**; it remains an
optional follow-up and must never be used to claim completeness.

## Gemini nightly news — still unproven (2026-09-26)

**Gemini has never produced a validated usable news event.** Do not report
otherwise on the basis of an HTTP 200.

Models tried in order: `gemini-3.8/3.7/3.6/3.5-flash` (`2.5-flash` 404s for
this key). One run sends 20–21 candidates in a **single batched call**, but
retry × model fallback could reach **4 models × 3 attempts = 12 calls**. The
assumed Free Tier budget is **RPD 20**, so repeated manual
`workflow_dispatch` runs in one day could exhaust it.

**FIXED (2026-09-26): `MAX_TOTAL_CALLS = 6`** in `gemini.ts`. The cap is
checked *before* each call, so the worst case is a constant rather than a
product, and an unattended nightly run can no longer spend 60% of the day's
quota on one bad night. A healthy run still costs exactly 1 call. Pinned by 4
tests, including one that asserts the cap leaves `gem.result === null` so
`run.ts` keeps using the deterministic fallback.

Real outcomes from workflow logs:
- `36187045238` — 12 × HTTP 503 across 4 models.
- `36189893618` — 12 × HTTP 503.
- `36215617435` (latest) — **`calls=1`, no 503, HTTP 200, yet "no usable
  events"**. A failure mode never seen before.

All these runs report `conclusion: success` because the pipeline exits 0.
**That is not Gemini succeeding.**

The third case was undiagnosable: the raw response was returned by
`synthesizeWithGemini` and then **discarded** by `run.ts`, and three very
different causes collapsed into one message. `gemini.ts` now names which cause
occurred (unparseable / unknown article ids / empty events) and
`GEMINI_DEBUG_RAW=1` persists the raw body to `pipeline/data/`.

**Still unproven:** that one normal nightly run fits the quota and reliably
produces usable semantic output. The deterministic fallback
(`buildNewsEvents` + `menRelevantNews`) is intact and the app is healthy
without Gemini, so nothing is at risk while this stays open.

---

# Lessons from the human-acceptance pass (2026-09-26)

Three defects shipped as "verified" and were found by a person holding a real
iPhone 13. All three root causes were wrong in my original diagnosis, and two
of them had nothing to do with the numbers I had been tuning.

## L-001  `page.mouse` can never catch a touch bug

Every pre-existing navigation and sheet test drove the UI with `page.mouse`,
which emits synthetic **mouse** pointer events. A phone emits **touch**
pointer events, and a browser treats them differently:

- `touch-action` is only consulted for touch input, so a mouse drag sails
  straight past a value that will make a real finger scroll the page;
- a touch gesture is arbitrated by the browser and can be **cancelled** with
  `pointercancel`, so the `pointerup` that commits the gesture never arrives.

`e2e/navigation.spec.ts` reported the swipe as working. On iPhone it was dead.

**Rule:** any gesture that must work on a phone is tested with CDP
`Input.dispatchTouchEvent`, never `page.mouse`. Chromium's *touch emulation*
is also insufficient — it passes while the code is still broken on iOS. Only
real dispatched touch events with an explicit `pointercancel` assertion
reproduce this class of failure.

## L-002  `touch-action` is NOT inherited

The fix for the dead swipe looked obviously correct: `touch-action: none` was
set on the `<nav>`. Measuring the computed value **down the bar** showed why
it did nothing:

```
nav  -> none   (correct)
list -> auto
item -> auto
link -> auto   <-- the element the thumb actually lands on
```

The `<a>` fills the bar, so the browser arbitrated the gesture *there* with
`auto`, consumed the horizontal pan as a scroll, and fired `pointercancel`.

**Rule:** assert the computed `touch-action` on the **innermost element the
finger lands on** (`.fabnav-link`), never on an ancestor. A parent's value
proves nothing.

## L-003  A dangling declaration silently deletes a whole block

`.sheet-body` had `padding` and `scrollbar-width` written *after* the closing
`}` of a preceding rule. A declaration that appears where a selector is
expected is a parse error, and it takes the rest of the block with it — so
`.sheet-body` had **no bottom padding at all**, and news/sheet text sat behind
the nav bar. No error, no warning, no test failure.

**Rule:** when a rule appears to be ignored entirely, check the text
immediately *preceding* it for orphaned declarations before anything else.

## L-004  Translucency over pure black needs tone, not alpha

The nav bar "looked like a solid black pill" over content. Raising alpha did
not help and eventually destroyed the content behind it, because the page
background is `--bg: #000000`: a translucent *black* over pure black is still
black. What lifts the surface is a **lighter base colour**, not more opacity.

Measured mean luminance and spread inside the bar at 390px with real content
behind it:

| variant | mean | spread | verdict |
|---|---|---|---|
| A `rgba(38,40,44,0.50)` (old) | 23.0 | 6.0 | black plate |
| B `rgba(35,35,38,0.82)` (proposed) | 30.0 | 2.0 | grey plate, content lost |
| C `rgba(42,44,48,0.62)` (**shipped**) | 29.1 | 4.0 | lifted, content legible |

`spread` is the discriminator: variant B separates best from `#000` but its
spread collapses to 2, meaning the content behind it has been painted out.

**Rule:** judge translucent chrome by *measured* luminance and spread, not by
reading the alpha value. A screenshot alone will not separate these.

## L-005  Acceptance means element movement, not a route change

The old swipe tests asserted only that the URL changed. A bar that slid out
from under the finger also changed the URL while feeling broken. The new
tests assert that the **bar's own `x` never moves** and that
`scrollWidth - clientWidth` stays 0 mid-gesture.

**Rule:** a gesture test must assert (a) the outcome and (b) that the
intended element stayed put. "It navigated" and "it felt right" are different
claims.

## L-006  Floating chrome needs viewport clearance, asserted numerically

A sheet overlapped the nav by an unknown amount. It is now asserted as a
number: sheet bottom 754 vs nav top 770 = **16px clearance**, driven by
`--chrome-bottom`. Re-check this if the bar height, the safe-area inset, or
the bar's own padding ever changes.

## L-007  A short drag correctly reads as a tap

While writing the tests I assumed a 10px drag must leave the route unchanged.
Measured, it navigates — and correctly so: it is under `FLICK_MIN_PX` (14), so
it is not a swipe, and the browser fires a `click` on the link under the
finger, whose `href` is that link's own destination. Nothing to fix.

The lesson is about the test, not the app: the first version of that test
started at `frac = 0.5`, which is the **boundary between tabs 1 and 2**, so
it was asserting the wrong destination. Starting on the already-active tab and
dragging the other way makes tap / swipe / no-op all distinguishable. Assert
against a start position you have measured, not one you assumed.

## L-008  Player search must not regress to a registry

The 31-entry hand-maintained registry was deleted and replaced with live
Wikidata search (`app/players/`). The registry was stale by construction: it
could only ever contain names someone remembered to add. Online search is the
only version that can answer a name the app has never seen.

**Rule:** do not reintroduce a curated player list. If enrichment dies, the
search must degrade to "search returned nothing" — never to a stale list.

## L-009  A shorthand in a later rule discards a longhand set in an earlier one

**Found 2026-09-26, in production, at a width no test covers.**

`@media (min-width: 700px) { .sheet { margin: 0 auto; } }` reset
`margin-bottom` to `0`, discarding the `margin-bottom: var(--chrome-bottom)`
that keeps the sheet clear of the floating nav. Measured on the deployed
site at 1222px: sheet bottom `y=1122`, nav top `y=1048` — the sheet sat
**74px under the nav** and its last rows were covered.

At 390px the clearance was the correct 16px, so the entire phone-sized e2e
suite passed, CI passed, and the deploy was green.

**Rules:**
- After any `margin`/`padding` shorthand, re-declare any longhand that
  matters. `margin: 0 auto` means "centre it", not "reset everything".
- **A suite pinned to one viewport cannot see layout bugs at other widths.**
  `playwright.config.ts` fixes `viewport: 390x844`, so 700px+ code was
  effectively untested. `e2e/layout.spec.ts` now loops VIEWPORTS
  (320/390/430/1024) and asserts numeric `nav.top - sheet.bottom >= 0`.
- **Verify the artifact you ship, in the artifact's real conditions.** The
  built CSS contained the correct rule; the bug was a *different* rule
  winning the cascade. Reading the source was not enough — I had to query
  which rules actually matched in the running page.
- **Playwright serves `dist`, not source.** After editing CSS, run
  `npm run build` before running Playwright, or you debug a stale bundle.
  This cost one confusing "the fix didn't work" cycle.

## L-010  A green CI run is not proof the flaky thing is fixed

`a11y.spec.ts › open sheets are scanned too` failed in CI on three
consecutive commits with `color-contrast: 13`, then `color-contrast: 18` on
the retry, while passing 11/11 locally. A varying node count is a race, not
a fixed styling defect.

Ruled out by measurement, not assumption: the nav labels (new surface
measures 5.84–6.52:1 against real content; the *old* surface was worse at
2.02:1, so the change improved it), animation timing (0–900ms, zero running
animations, identical result), the sheet content in isolation and in
sequence, and config differences. The next run passed.

**Rules:**
- A count that changes between attempts is evidence of a race. Fix the
  observability first: make the assertion name the element, the measured
  ratio and the resolved colours, so the next failure is a diagnosis.
- When a test is red somewhere you cannot reproduce, **record what you ruled
  out**. Otherwise the next session re-investigates from zero.
- Do not "fix" a test you cannot reproduce. Change what is observable, and
  say plainly that the cause is unknown.

## L-011  SOLVED — the CI-only a11y failure was a mid-animation sample

**Root cause found and proven 2026-09-26.** Not a flake, and not a styling
defect in the resting state.

The improved assertion (L-010) made CI name the elements on run 36271880293:

```
color-contrast (serious): 10 nodes
  .mod-label  "Aktualitet"  ratio=3.66 need=4.5  fg=#6a6a6a bg=#0a0a0a
  .rl         "OK"          ratio=3.66 need=4.5  fg=#6a6a6a bg=#0a0a0a
```

`bg=#0a0a0a` is the tell. The sheet surface is `--surface: #0e0e0e` (14).
A background *darker* than the sheet itself can only be the sheet scaled
toward the black page — i.e. `.sheet-backdrop` part-way through its
`--dur-dismiss: 220ms` `fade-in` from `opacity: 0`.

Solving for the opacity that reproduces CI's numbers exactly:

| opacity | bg | fg | ratio |
|---|---|---|---|
| 0.689 | `#0a0a0a` | `#6a6a6a` | **3.665** |
| 1.0 (rest) | `#0e0e0e` | `#9a9a9a` | 6.84 — passes |

`3.665` against CI's reported `3.66` is a match, so the sheet was sampled at
~69% opacity. `.mod-label`/`.rl` use `var(--text-3)`
(`rgba(255,255,255,0.58)`), which has **6.84:1** at rest. The colours were
always fine; the scan just caught the fade.

This also explains the varying counts (13 → 18 → 10): each run sampled a
different point in the fade. And why it never reproduced locally — the test's
`waitForTimeout(600)` usually outlasts the 220ms fade, and `toBeVisible()`
returns as soon as the element is laid out, which says nothing about whether
an animation has ended.

**Fix:** `animationsSettled()` waits on
`document.getAnimations().every(a => a.playState !== "running")` before each
scan. Deterministic instead of hoping a timeout is long enough. Verified
44/44 across `--repeat-each=4`.

**Rules:**
- **A count that changes between attempts is a timing signal.** Follow it to
  the animation clock rather than the stylesheet.
- **`toBeVisible()` does not mean "settled".** Any assertion about a pixel
  property (colour, contrast, position) must wait for animations to finish.
- Note this is a *transient* accessibility dip only: users under
  `prefers-reduced-motion: reduce` get `animation: none` on `.sheet-backdrop`
  and never see it. The resting state passes AA comfortably.

## L-012  A stale service worker will make a shipped fix look broken

After deploying the sheet-clearance fix, the live app still measured
`margin-bottom: 0px` and `-74px` clearance. The fix was in the served CSS —
but the **page was running the previous bundle**:
`index-suOhB03Q.css` instead of `index-NPUKbndc.css`, from the workbox
precache of an earlier visit.

After `getRegistrations().unregister()` + `caches.delete(...)` + reload, the
same measurement returned `margin-bottom: 90px` and **16px clearance**.

**Rules:**
- Before believing any browser measurement of production, assert WHICH
  asset is loaded. `document.styleSheets[0].href` compared against the
  `index-*.css` you just built settles it in one call.
- `curl`ing the asset is not enough. It proves the bytes are deployed, not
  that the browser is using them.
- This is the third time the stale SW has produced a false "the deploy
  failed" conclusion in this project. It is the default hypothesis when a
  shipped change appears to have no effect.

---

# Product / UX / content pass (2026-09-26)

Driven by human observation on the real app, not by a test failure. Each
item below records the DECISION, not just the change, because the reasoning
is what stops the same thing being reintroduced.

## P-001  The player model: search-first, and enrichment is never a gate

**Spelare is a football-player search, not a former-player list.**

The premise is "a footballer you are looking for". A BK Häcken connection is
**enrichment shown alongside, never a precondition**. Gating on it would
reproduce the closed list this page replaced, in new clothing: a supporter
who remembers a player the data does not know about would again be told
"nothing found", and the app would be lying by omission.

Consequences that are now enforced by tests:
- a player with **no** recorded club is found, shown, and **starable**;
- the card says "Wikidata anger inte BK Häcken som klubb" *and* adds "Det
  betyder inte att hen inte spelat där" — absence of evidence is never
  rendered as evidence of absence;
- status is never inferred. No club recorded does not mean retired, and does
  not mean free agent. "Okänd" is a legitimate, common answer.

## P-002  Mats Hedén — the acceptance finding

A supporter found **Mats Hedén (b. 1976)** through search, but the app could
not identify or verify the BK Häcken connection for him.

Verified in production: he resolves to **Q103846058**, a person and a
footballer, with **no P54 at all** — Wikidata records no club for him, so
there is nothing to verify. That is a **data gap, not a reason to hide
him**, and he is now the pinned acceptance case in
`e2e/former-players.spec.ts`.

He is starable. That is the whole point of the architecture.

## P-003  Starred players are a visible collection, not a silent save

The reported defect: after starring someone the search result stayed on
screen and **there was no visible list of starred players**, so the save
looked like it had done nothing.

The mental model is `SEARCH → find → star → the player is now in "Följda
spelare"`. So the starred set is rendered as its own section, above the
search results, and it **survives clearing the search, navigating away, and
a reload**.

This required a storage change. Favourites were persisted as bare Q-IDs,
which cannot be rendered — a starred player had to be listed without
re-running the search that found them, and `"Q103846058"` is not something a
supporter can read. The store now holds a **snapshot** (name, life dates,
nationality, Häcken link, starred-at) alongside the id. Legacy id-only
entries are dropped rather than shown as blank rows.

## P-004  Häcken enrichment is not a gatekeeper for starring

Starring requires only that the player was found. The stored Häcken link is
recorded as **what was shown at the time**, not as a filter. A starred player
with no verified link is listed exactly like one with it, and is labelled
`HÄCKEN OKÄNT` in a deliberately dimmer style than the confirmed `HÄCKEN`
tag — an unverified link must never look like a verified one at a glance.

## P-005  Former-player information model — what exists and what does not

| Field | State | Note |
|---|---|---|
| name | implemented | Wikidata label |
| photo | **not implemented** | no reliable per-player image; a wrong or generic face is worse than none |
| active / retired / unknown | implemented | three-valued; never inferred |
| current / latest club | partial | the club list Wikidata holds; **current** club is NOT derivable |
| Häcken connection + provenance | implemented | men / women / not recorded, with the Q-ID shown |
| career / transfer context | **not implemented** | would need a per-stint source |
| season statistics | **not available** | see P-007 |
| matches / starts / minutes | **not available** | provider does not record them |
| goals / assists | **not available** | only per-match event data for the latest match |
| cards | available for current squad only | via the discipline ledger, not for former players |
| contract expiry | **not implemented** | a verified contract source does not exist here; inventing one is forbidden |

**Nothing above was invented to fill a gap.** Where the data is absent the UI
says so in words. A speculative data source will not be added merely to
populate an empty field.

## P-006  Swedish home/away convention: HOME left, AWAY right

Every match presentation now reads **home team on the left, away team on the
right**, and the score belongs to that order.

The data is provider-ordered (`scoreHome` / `scoreAway`) and the old UI
rendered "Häcken first", which **silently reversed the numbers for every away
match**. Concretely, the 20 Sep game at Kalmar (`homeAway: "away"`,
`scoreHome: 0`, `scoreAway: 5`) read **"5–0"**, where the Swedish reading of
*Kalmar 0–5 Häcken* is **"0–5"**. A supporter glancing at a result should
never have to remember which way round the provider happened to store it.

`scoreForHacken` is kept where Häcken's own point of view is genuinely wanted
(result colouring, the form guide); `scoreForHomeAway` is used wherever the
two teams sit side by side. Häcken's result is still carried explicitly, by
the row's colour and the "Hemma"/"Borta" label.

## P-007  Match sheet: purpose, and the goalscorers move

Hem printed a truncated one-line goalscorer list inline, which turned the
dashboard's most important row into an event log. **Hem stays a concise
supporter dashboard**; the detail moved into the match sheet, which now
presents the fixture (home left), an explicit **Målskyttar** list with
assists, the full chronological timeline, and statistics.

## P-008  Actual statistics only — and an honest absence

"Events per minute" and other event-derived calculations are **not football
statistics** and are not presented anywhere. (Verified: no such calculation
existed in the codebase — the rule is now pinned by a test so it cannot be
added casually.)

`MatchDetail.playerStats` is **never populated** by the current pipeline, so
the sheet states that plainly instead of deriving a substitute from the event
list. An invented number that looks like data is worse than an admitted gap.

## P-009  Discipline rows are interactive and show the real count

The players in Hem's card/suspension section are now buttons that open that
player's sheet, and each row prints the player's **actual season card total**
from `warningCount` in the data. The number is **never hard-coded per
player** — a hard-coded count is a fact that silently rots.

## P-010  The redundant yellow dot is removed, not replaced

The active destination already reads as active: its label turns yellow. A 4px
yellow dot was *also* drawn via `::after` with `margin-top: 30px`, which on a
9.5px label landed **inside the text** — overlapping and blurring the letters
it was meant to support. It is removed and **nothing replaces it**: a second
cue for the same state is redundant, not clearer.

## P-011  Hem, not "Brief"

The first destination is labelled **Hem**. "Brief" was internal jargon that
leaked into the navigation. The component and file keep their names (`Brief`,
`tab-brief`) because renaming internals is churn with no user benefit — but
the label the supporter reads is Hem.

## P-012  News: a count must describe what is visible

"Senast · 6 nyheter" sat above **four** cards, because the count came from
the whole feed while the section renders `GRID_COUNT` (4) with the remainder
under "Tidigare". The count now describes **its own section**. A number the
reader cannot see on screen is a wrong number.

## P-013  Search focus must not move the page (Section B)

**Not reproducible in desktop Chromium** — measured at 390×844 and 375×812:
the field's left edge stayed at x=16, `scrollLeft` 0, zero overflow, on both
a programmatic `.focus()` and a real CDP touch tap. It is a real mobile
defect, so the three mechanisms that cause it on a phone are guarded rather
than assumed:

1. **iOS zooms when a focused field is under 16px**, and that zoom is what
   moves content sideways. The field is now explicitly 16px.
   `maximum-scale` is deliberately **not** used to suppress the zoom — that
   fails WCAG 1.4.4.
2. `min-width: 0` on the field and input, so the flex row cannot outgrow its
   container and give the document a horizontal scroll range.
3. `scroll-padding-inline`, so focusing an edge element cannot scroll it
   under the viewport edge.

The e2e test asserts the **invariants** (no scroll range, no movement,
`font-size >= 16px`) rather than a pixel offset, so it is meaningful on any
engine. **Human confirmation on the actual iPhone is still required.**

## P-014  Starred players are the future research set

Preserved as product direction, deliberately **not** implemented in this pass:
the user's starred players are the natural candidates for deeper research
later (current club, recent news, contract status), via LLM-assisted research
and complementary sources.

Two things must never happen: **no master database of all former Häcken
players**, and **no automatic research of all former players**. The
user-curated starred set is the intended research set. This pass only makes
the starring architecture correct enough to support that later.

## P-015  Real-touch navigation is the only acceptable proof

The nav swipe must be verified with dispatched touch events and an explicit
`pointercancel` assertion. `page.mouse` cannot catch this class of bug — a
mouse drag has no `touch-action` arbitration, which is exactly why the swipe
shipped broken while the suite was green. See L-001.

## P-016  Responsive sheet clearance is asserted, not assumed

All bottom sheets are checked at 390×844, 375×812 and 1024×768, because a
suite pinned to one viewport structurally cannot see a `min-width: 700px`
cascade bug — which is exactly how the sheet spent a release 74px underneath
the nav while every phone-sized test passed. See L-009.

## N-001  Post-pass findings — NOT fixed in this pass

Recorded per the change-control rule: discovered during browser acceptance,
reported, deliberately not fixed.

### N-001a  `playerStats` is declared but never populated
`MatchDetail.playerStats` exists in the type and the sheet renders it when
present, but the pipeline never fills it for this competition, so the sheet
always shows the honest "no statistics recorded" note. **This is correct
behaviour today** and is documented in P-005/P-008. The finding is that a
declared-but-dead field invites someone to assume statistics exist.

### N-001b  Section B could not be reproduced on desktop Chromium
The search-focus horizontal shift was reported from a real phone. Measured
at 390×844 and 375×812, on both a programmatic `.focus()` and a real CDP
touch tap: field left edge stayed at x=16, `scrollLeft` 0, `visualViewport
.offsetLeft` 0, zero document overflow. The three iOS-specific mechanisms are
guarded (16px font, `min-width: 0`, `scroll-padding-inline`) and the e2e test
asserts the invariants rather than a pixel offset. **Human confirmation on
the actual iPhone is still outstanding** — this is the one item in the pass
that is reasoned + guarded, not observed fixed.

### N-001c  A one-off pitfall worth keeping: measure sheets at rest
A first production measurement of sheet clearance returned −727px and −661px
at two viewports. The cause was the probe, not the app: it waited for "no
running animations" and measured while `sheet-in` was still translating the
sheet up from `translateY(100%)`. Waiting for the transform to actually
settle (`none` / identity matrix) returned **16px everywhere**. A sheet
geometry assertion that does not wait for the resting state will report a
large negative clearance and look like a catastrophic overlap.

---

# Next work after current production acceptance — 2026-09-27

**Documentation-only closing pass.** No application code, tests or
configuration were changed, no bugs were fixed, and nothing was deployed.
This section exists so a fresh Space Bunny chat can continue from the exact
current state of the completed product/UX/content pass without re-deriving
anything.

All sections above (E-*, B-*, L-*, P-*, N-001) are preserved history. This
section supersedes nothing; it is the handoff.

## Established workflow rule

    USER AUTHORIZES SCOPE
    → SPACE BUNNY IMPLEMENTS
    → VALIDATES
    → DEPLOYS
    → REPORTS
    → USER DECIDES WHETHER ANOTHER CHANGE PASS STARTS

If a post-deployment finding appears **outside** the authorized scope, report
it verbatim as:

> **Post-deployment finding — not fixed in this pass**

Do not silently expand scope. Do not begin exploratory investigation of new
issues that were not named in the user's authorization.

## Current verified state (2026-09-27) — do not re-derive

This is the state the completed pass left behind. It is recorded here so a new
chat does not repeat discovery. **Do not rerun these validations merely to
document them.**

| Item | Value |
| --- | --- |
| Production deployment | **green** |
| Deployed assets | explicitly verified **after purging the stale service worker** |
| Production ↔ local `dist` | **byte-match** |
| Unit tests | **297 passing** |
| E2E tests | **177 passing** |
| `tsc -b` | clean |
| eslint | clean |
| `vite build` | clean |
| `pipeline:validate` | clean |
| CI run | **`36276855594` successful** |
| Working tree | clean |
| Latest commits | `586bc73` (product/UX pass), `d299722` (docs only) |

## Outstanding items

### N-001b — iPhone search-field acceptance · **HUMAN ACCEPTANCE REQUIRED**

The search-field horizontal-shift problem **reported by the human user was
NOT reproduced by Space Bunny.**

Automated and browser verification showed, on the deployed application:

- 390×844 — no horizontal movement
- 375×812 — no horizontal movement
- `scrollLeft` remained 0
- `visualViewport.offsetLeft` remained 0
- no overflow
- iOS-related safeguards are present (16px field font, `min-width: 0`,
  `scroll-padding-inline`)

**This was not verified on the physical iPhone 13.** The e2e test asserts
invariants (no scroll range, no movement, `font-size >= 16px`) rather than a
pixel offset, so it is meaningful on any engine — but an invariant assertion
is not the same as observing the defect gone on the device where it occurs.

**Next action:** test the deployed application on the **physical iPhone 13**,
especially focusing/tapping the **Spelare** search field, and observe whether
the surrounding layout shifts horizontally.

**Do not mark this accepted merely because browser tests pass.**

### N-001a — `MatchDetail.playerStats` · **OPEN / FUTURE ENHANCEMENT**

- `MatchDetail.playerStats` is **declared but currently not populated**.
- The match sheet therefore honestly displays that no statistics are recorded.
- **No statistics may be invented or inferred from event data.** The previous
  implementation implied possession/shots from goal timestamps; that was
  removed on purpose.
- Actual match statistics should be added **only when a reliable source is
  available.** See also P-008.

### Former-player enrichment · **OPEN (future, conditional)**

The player-first / search-first architecture is **now working** and has
human/product acceptance (see below). Remaining enrichment fields, where
reliable sources are **not currently available** — all **OPEN**:

- photo
- transfers / career detail
- season statistics
- matches / starts / minutes
- goals / assists
- cards, where appropriate
- current / latest club
- contract expiry
- recent whereabouts / news

**Architectural decisions that must be preserved (P-001, P-004, P-014):**

- A player **can be searched and followed even when Häcken affiliation cannot
  be verified.**
- **"HÄCKEN OKÄNT" is preferable to inventing a connection.**
- Following a player **must not depend on complete enrichment.**
- **There is no master historical former-player database**, and none will be
  built. Do not turn this into a requirement to research every former Häcken
  player.
- The intended future model is:

      SEARCH → FOLLOW → optionally research the user's followed players later

### Gemini news research · **NOT SOLVED**

Gemini news research has **NOT yet produced a validated, usable news event.**
Do not classify this as solved.

- Do **not** spend additional Gemini quota in this closing pass.
- Future work should be a **separate, deliberately bounded Gemini validation
  experiment.**
- **The Gemini experiment must not become release-critical** unless it produces
  demonstrably useful, validated output. The safe fallback path is intact and
  the app is healthy without it.
- Background: free-tier key authenticates (`listModels` → HTTP 200) but has
  **no generation capacity** — 404 "no longer available to new users" /
  503 UNAVAILABLE. Bounded retry is in place. See the Gemini sections above.

### E-003 — Amor Layouni in the discipline ledger · **OPEN**

**E-003 — Amor Layouni remains in the discipline ledger as `at_risk` despite
having been sold.**

Correctly absent from the current squad (27 players), but still in the
registry/former-player data and still carrying 2 warnings in the discipline
ledger, which spans the full season including pre-transfer matches.

Status: **OPEN.** Needs a **separate decision/fix pass. Do not fix now.**

### 220ms sheet fade-in contrast dip · **OPEN DESIGN / ACCESSIBILITY DECISION**

- There is a short **contrast dip during the ~220ms sheet fade-in** for users
  without `prefers-reduced-motion`.
- **At rest, contrast passes.**
- **Reduced-motion removes the animation.**
- The current implementation **deliberately preserves the iOS-style
  transition.** Do not change it now.

**Future decision:** either retain the animation as-is, or adjust the
transition **if real-device / user testing demonstrates that the transient
contrast is unacceptable.** Underlying analysis is in L-004 and L-011.

## Human-verified player state

The current player / followed-player UX has been **human-verified** to the
following extent:

- Former-player search works.
- **Martin Ericsson** can be found and followed.
- **Mats Hedén** (born 1976) can be found and followed.
- Mats Hedén can be followed **even though Häcken enrichment is
  `HÄCKEN OKÄNT`**.
- Followed players are shown under **"Följda spelare"**.
- The collection **remains visible after clearing the search**.
- Saved players **can be opened from the followed-player list**.
- The UI **does not invent a Häcken connection**.

Observed collection state: `Följda spelare · 2` — Martin Ericsson (`HÄCKEN`),
Mats Hedén (`HÄCKEN OKÄNT`).

**Do not claim that every aspect of the player experience is fully accepted on
physical iPhone** unless that has actually been tested. See N-001b.

## Suggested continuation order

**This is a suggested order only. It is NOT automatic authorization to
implement any of it.** Each item still requires an explicit, separately
authorized change pass.

1. **Human acceptance on the physical iPhone 13** — especially N-001b.
2. Review any findings from that real-device test.
3. Decide whether any remaining Min BKH items warrant **another explicitly
   authorized change pass**.
4. Separately perform a **tightly bounded Gemini validation experiment**,
   after quota reset.
5. Address **E-003** separately, if still relevant.
6. Consider **future player enrichment** only if it provides real user value.
7. Consider **`MatchDetail.playerStats`** only when a reliable statistics
   source is available.

## Fresh-chat handoff statement

> **The previous pass is closed. The next Space Bunny session must treat this
> section as the current handoff state and must not assume that unresolved
> findings are automatically authorized for implementation.**
