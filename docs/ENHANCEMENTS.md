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

## Blockers

### B-001 · Gemini semantic news processing
`BLOCKED — external service`

Gemini 3.8 Flash currently returns `HTTP 503 UNAVAILABLE "high demand"`. The key
authenticates correctly (`listModels` → HTTP 200), so this is server-side
capacity or account tier, not a code defect. All four candidate models 503,
including an 8-word probe.

**Keep the deterministic fallback operational.** Revisit when service capacity
stabilises.

**Bounded retry is in place** (2 retries, 5s/20s backoff, transient errors
only; 400/401/403/404 never retried). Safe fallback intact. No action needed in
code.

**Consequence while blocked.** The live news feed is the deterministic
fallback: single-source cards, the four Gustav Lindgren reports are not merged
into one event, and women's-team articles are not excluded by the new
classifier. The eight-article semantic regression remains unverified.

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
  work on E-006/E-008 starts from that fact.
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
