# CONTINUATION — B-029: Wikidata-identity disambiguation for homonym false positives

**Status at handoff (2026-10-20 23:47 CEST):** repo clean at `4445006` (plus this untracked file).
**No code written for B-029 yet.**
The investigation is COMPLETE and the answer is POSITIVE — a robust solution exists and is measured.
Next action: implement B-029, test, deploy, regenerate data, byte-verify.

### How to resume (first 5 commands)

```bash
cd "/home/lm/Dev/BKH pwa app"
git --no-pager log --oneline -3
git status --porcelain
npm --prefix pipeline test -- --run     # or the repo's own test command — 738 tests, must stay green
gh workflow list
```

Then read §5 (the plan) and §6 (gotchas) below before touching code. The single most important
constraint: **the gate must be restricted to FOOTBALLER twins** — the all-human variant cost 5 genuine
articles (§4.1).

---

## 1. The user's request (verbatim, most recent)

> "i see that the late news article about kalmar and degerfors is referring to the sebastian ohlsson that
> has no häcken background … there are two footballers named Sebastian Ohlsson currently associated with
> Degerfors IF. One was born in 1992 and plays as a defensive midfielder, while the other was born in
> 1993 and plays as a right-back and midfielder. … see if a new solution can solve this issue. if not let
> me know before you do any changes"

> "https://forzafootball.com/match/degerfors-if-kalmar-ff-1219499965/lineups here i can find which
> sebastian ohlsson that was playing easily. are you still searching"

> "number 7 is on … /lineups under unused substitutes. have you found it"

**Gate honoured:** the user asked to be told *before* changes. The answer is "yes, a solution exists" —
that report was delivered in-conversation; implementation is authorised to proceed.

## 2. GROUND TRUTH (verified this session — do not re-litigate)

The false positive: **Expressen — "Kalmar bröt den tunga sviten – slog Degerfors"**
`https://www.expressen.se/sport/fotboll/allsvenskan/kalmar-brot-den-tunga-sviten-slog-degerfors/`
summary: *"– Total katastrof, säger Sebastian Ohlsson i TV4 Play."* → classified `FORMER_PLAYER` / category `former`.

**Two real footballers, IDENTICAL Swedish label "Sebastian Ohlsson":**

| | **Ours** | **Twin** |
|---|---|---|
| Wikidata | **Q17461659** | **Q16633334** |
| Born | 1992-12-31 | 1993-05-26 |
| Häcken | **YES — BK Häcken 2014–2015** | **NO** (Örgryte / IFK Göteborg / St. Pauli / Degerfors) |
| Position (P413) | mittfältare (Q193592) | anfallare/försvarare |
| Shirt | **#7** | **#16** |
| Fogis (P5038) | 370608 | **367391** |
| Transfermarkt (P2446) | 205436 | 217357 |
| Height/weight | 186 cm / 73 kg | 184 cm / 76 kg |
| Youth club | Hova IF | Qviding FIF |

**NOTE — the user's premise is INVERTED.** The user believed the 1992-born one was the non-Häcken one.
Ground truth is the opposite: **1992 = former Häcken player; 1993 = no Häcken background.**

**The article quotes the player who STARTED that match.** Forza Football lineups for
Degerfors 1–2 Kalmar, 2026-10-19 (match id 1219499965), reached via `r.jina.ai` (site 403s curl+browser):
- **#16 (b. 1993, player id 2178907) — STARTED** (in the starting XI block)
- **#7 (b. 1992, player id 1314006) — UNUSED SUBSTITUTE** (user confirmed this reading)

Corroborating: `degerforsif.se/truppen-mot-kalmar-i-omgang-24/` lists both #7 and #16;
SvenskaFans startelvor has one Ohlsson in the XI and one on the bench;
Nerikes Allehanda calls the speaker **"backen Sebastian Ohlsson"**; Aftonbladet: "Degerfors Sebastian Ohlsson
sågade lagets insats i början av matchen."

⇒ **The article is about the 1993-born twin. It IS a false positive for this app.**

## 3. WHY NO TEXT RULE CAN FIX THIS (proved)

- Both entities carry the **byte-identical** label "Sebastian Ohlsson"; neither has P1477/P1559.
- The match fires on **`mentionsKnownPerson` PASS 1 (full name)** — the strongest pass, which bypasses
  every B-028 guard (different-person, capitalization, score-compound).
- The article states no position, no DOB; names no club beyond "Degerforsspelaren"; **BOTH** players are
  at Degerfors, so club does not separate them. Degerfors stint qualifiers are EMPTY on the twin's side.
- Expressen bodies are **never fetched** (paywalled + Bonnier robots.txt) → `bodyText` is empty →
  there is no position/DOB text to read even in principle.
- Surname-only would be worse (both surnames identical).

⇒ A **data/identity layer (Q-ID)** is mandatory. This is the answer to "robust solution once and for all".

## 4. THE SOLUTION — measured, not guessed

### 4.1 The "shadow set" (same-label human twin), computed nightly from Wikidata

Single SPARQL, `SELECT DISTINCT` self-join on `rdfs:label` (former ∪ squad QIDs):
**1.85 s, one request, 467 rows, 58 labels with a human twin, 17 with a FOOTBALLER twin.**

⚠️ **The `GROUP_CONCAT` form of the same idea TIMES OUT (>60 s). The `DISTINCT` form must be used at runtime.**

- **289 former-player entities; 58 labels (20%) have a same-label HUMAN twin; 17 have a FOOTBALLER twin.**
- Gate must be restricted to **footballer twins** (P106 = Q937857):
  - **footballer-twin gate: drops 1 item (the FP) and 0 genuine articles** across the 90-item corpus ✅
  - blanket "any human twin" gate: drops 1 correct + **5 wrong** (all Julius Lindberg) ❌ **REJECTED**
- Corpus = 90 unique news items across all committed `app.json` snapshots; 26 classified via a known
  person; 11 distinct persons; only 3 items have no Häcken mention (Ohlsson = FP; Heintz Q29415639 and
  Fagerjord Q96749112 = TRUE positives, both P54 = BK Häcken).

### 4.2 Discriminators available, in escalating cost order (for the 17 footballer-twin labels)

| Discriminator | Result |
|---|---|
| **position (P413)** | 7 pairs separable — incl. Ohlsson (ours *mittfältare* vs twin *anfallare*) |
| **DOB (P569)** | the other 10 |
| **club** | **0** pairs separable — useless |
| **P1889 "different from"** | 13 same-label former pairs carry it (11 footballers) but **6 footballer-twin labels LACK it** (Jonas Henriksson, Leif Forsberg, Peter Eriksson, Peter Nilsson, Rasmus Lindgren, Tobias Carlsson) → strong *positive* signal, NOT sufficient |
| **roster/lineup corroboration** | `fetchSquadSm`/`fetchLineupsSm` + fogis id — for the FP match only the twin started (#16, fogis 367391 → Q16633334) |

**External ids (the join key to real-world data), present on BOTH sides of the pipeline:**
P5038 = fogis.se, P1238 = SvFF, P2446 = Transfermarkt, P12302 = Sofascore, P2369 = Soccerway,
P5750 = FBref, P1618 = shirt number. Reverse lookup proved **fogis 367391 → Q16633334** (the twin).

### 4.3 Squad side measured
- Our **David Andersson = Q124620884** (fogis 872878, b. 2003-09-16); twin **Q121143384** (b. 1891-06-18,
  IFK Göteborg) + 6 non-footballer humans.
- Our **Julius Lindberg = Q97102447** (fogis 705320, b. 1999-01-04); twin **Q18166462** = Finnish politician
  1878–1953 — ⚠️ this is exactly why the blanket all-human gate is rejected (5 genuine articles).
- `app.json` → `squadEnrichment` is a **dict** keyed by `playerId` (`fogis:872878`) carrying `qid`, `name`,
  `dateOfBirth`, `position`, `career` for **26 of 27** squad players.

## 5. THE PLAN (B-029)

**Design: a computed "ambiguity" signal, not a maintained list.**

1. **`pipeline/src/formerPlayers.ts`** — extend to return STRUCTURED entries instead of `string[]`:
   `{ qid, name, aliases, position, dob, fogisId }`. Keep `fetchFormerPlayers` behaviour for
   compatibility; add a new function that preserves the Q-ID.
2. **New module `pipeline/src/playerAmbiguity.ts`** (or extend `squadEnrichment.ts`) —
   `buildShadowSet(entries)`:
   - ONE SPARQL query, `SELECT DISTINCT` self-join on `rdfs:label`, restricted to
     `P106 = Q937857` (footballer) on the twin side.
   - Returns: for each of OUR people, the set of same-label **footballer** twins (QIDs + their position/DOB).
   - Also include the current squad (Q-IDs from `squadEnrichment.qid`).
   - **Failure must be NON-FATAL** (like `fetchFormerPlayers`): empty set ⇒ no gate ⇒ old behaviour.
3. **Wire into `known`** in `run.ts` — extend `KnownPersons` with an optional
   `ambiguousPeople?: Map<string, {qid, twins}> | Record<string, ...>`.
4. **The gate in `newsRelevance.ts`** — inside `mentionsKnownPerson`, when a match is found for a person
   that has a footballer twin, the match is only accepted if **independent Häcken evidence** exists.
   Ordering matters: the gate must run in **PASS 1** too (the Ohlsson FP originates there).
   Escape conditions to evaluate (pick the cheapest that works):
   - the article mentions Häcken/Häckens in the Häcken context (the twin has no Häcken link), OR
   - position/DOB of the twin contradicts our person, OR
   - roster/lineup corroboration (expensive — only as last resort).
   ⚠️ **Design constraint from the measurement:** the gate must be *narrow* — the **all-human** variant
   cost 5 genuine Julius Lindberg articles. The **footballer-twin** variant cost 0.
5. **Tests** (`pipeline/src/newsRelevance.test.ts`):
   - Ohlsson FP → **rejected**.
   - The 5 Julius Lindberg articles → **accepted**.
   - Heintz (Q29415639) and Fagerjord (Q96749112) → **accepted**.
   - All 93 existing tests + the 19-row surname-collision table stay green.
6. **`docs/ENHANCEMENTS.md`** — new **B-029** section + status-table row. Record: the text-rule
   impossibility proof, the measured cost, the REJECTED blanket gate, the Wikidata rate-limit gotchas.
   Never edit `docs/archive/`.
7. **Commit → push → deploy → regenerate data → byte-verify.**
   - ⚠️ **Code fixes alone do NOT change served data.** `app.json` is regenerated only by
     `data-update.yml`. Run `gh workflow run data-update.yml --ref main` after the deploy.
   - Byte-compare: `git show HEAD:public/data/app.json | sha256sum` vs
     `curl -s https://danielomazarino.github.io/Min-BKH-app/data/app.json | sha256sum`.
   - Confirm the Kalmar article is **absent** from the served feed.

## 6. CRITICAL GOTCHAS (learned the hard way)

- **Wikidata rate limits:** ~25–35 s backoff between heavy queries; descriptive User-Agent; several
  requests returned HTTP 504 "upstream request timeout" with an empty body.
- **`SELECT DISTINCT` only** — the `GROUP_CONCAT` variant times out.
- **`VALUES ?label { … }` only binds `?label`**; you must `SELECT ?label` explicitly or the mapping is lost.
- **JS regex:** the `i` flag makes `[\p{Lu}]` case-insensitive, silently destroying the capitalization
  requirement → use `ciPattern` (either case) / `capitalizedPattern` (first char forced uppercase).
- **Never decide "starter" by name equality** against `starting` — both Ohlssons share the name.
  Separate the `starting` and `substitutes` arrays directly (I made this bug and fixed it).
- **Expressen bodies are never fetched** → `bodyText` empty for those items. Don't design a fix that
  depends on body text for Bonnier publishers.
- **Do not run `npm run pipeline`** (12-request path) for diagnosis.
- **Service worker caches `/data/*.json` with `NetworkFirst`** → a browser screenshot can lie. Use curl.

## 7. REPO RULES (AGENTS.md) — non-negotiable

- Data generation ≠ data deployment. Verify the **served artifact** with curl, never a green workflow
  or a screenshot.
- Byte-compare committed vs served.
- `GITHUB_TOKEN` pushes do NOT trigger workflows; `workflow_dispatch` is not suppressed and is the
  mechanism to chain a deploy.
- Never edit `docs/archive/` — it is a frozen record.
- For iPhone testing, **deployed is the only "done"**.
- Record incidents in `docs/ENHANCEMENTS.md`.
- Commit trailer: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## 8. WHERE EVERYTHING LIVES

**Repo files:**
- [pipeline/src/newsRelevance.ts](</home/lm/Dev/BKH pwa app/pipeline/src/newsRelevance.ts>) —
  `mentionsKnownPerson` (~line 254: **pass 1 full name ← Ohlsson FP origin**; pass 2 surname with the
  capitalization gate + `pairSources` guard), `matchKnownMan` (~556), `classifyRelevance` (~600),
  `evidenceText` (~93), `casedEvidenceText` (~133), `slugText` (~76), `ciPattern` (~210),
  `capitalizedPattern` (~225), `isNonFootballSport` (~527), `KnownPersons` (~36).
- [pipeline/src/formerPlayers.ts](</home/lm/Dev/BKH pwa app/pipeline/src/formerPlayers.ts>) (124 lines) —
  `buildFormerPlayersQuery()` (P54=Q639723, P106=Q937857), `fetchFormerPlayers()` (**returns `string[]`
  — the Q-ID is discarded here**), `subtractCurrentSquad()`.
- [pipeline/src/squadEnrichment.ts](</home/lm/Dev/BKH pwa app/pipeline/src/squadEnrichment.ts>) —
  `SquadEnrichment` (~55) already carries `qid`, `dateOfBirth`, `position`, `career`; `enrichSquad` (~214).
- [pipeline/src/sportomedia.ts](</home/lm/Dev/BKH pwa app/pipeline/src/sportomedia.ts>) —
  `fetchLineupsSm` (~194), `fetchSquadSm` (~199) — roster/lineup with `fogisId`; `lineupsQuery` (~151);
  `SQUAD_QUERY` (~163).
- [pipeline/src/playerIdentity.ts](</home/lm/Dev/BKH pwa app/pipeline/src/playerIdentity.ts>) (79 lines) —
  the existing canonical-identity layer (`fogis:<id>` / `name:<key>`), **not** used by news relevance.
- [pipeline/src/run.ts](</home/lm/Dev/BKH pwa app/pipeline/src/run.ts>) — builds `known` (~444);
  `enrichSquad` at ~758 (runs AFTER news classification — if the shadow set needs squad Q-IDs, it must be
  moved earlier or queried independently); news classification at 493/502/717/729/785.
- [pipeline/src/classify.ts](</home/lm/Dev/BKH pwa app/pipeline/src/classify.ts>) —
  `menRelevantNews(items, known)` (~156): admits on `rel.matchedPerson && isMenOrFormer`; sets
  `category` to `former`/`men`. A rejected person match falls through here.
- [pipeline/src/newsPrefilter.ts](</home/lm/Dev/BKH pwa app/pipeline/src/newsPrefilter.ts>) — calls
  `classifyRelevance` at ~107 when `known` is given.
- [app/players/wikidata.ts](</home/lm/Dev/BKH pwa app/app/players/wikidata.ts>) — already has
  `hackenClub`/`hackenTeam`/`isFootballer()`; the P54-corroboration concept exists in the app layer.
- [pipeline/src/newsRelevance.test.ts](</home/lm/Dev/BKH pwa app/pipeline/src/newsRelevance.test.ts>) —
  93 tests. The "surname collisions — the whole historical class, in one table" block is the regression net.
  `FALSE_POSITIVES` tuple type is `[string, string, string, string?, string?][]`.
- [docs/ENHANCEMENTS.md](</home/lm/Dev/BKH pwa app/docs/ENHANCEMENTS.md>) — source of truth. B-028 at
  ~560; status table ~3005. **B-004 (Gemini validation) is still open.**

**Temp artifacts — CLEANED UP (done 23:52).** All investigation scratch files under `/tmp` were removed.
The four artifacts that are actually needed to re-run the measurement were preserved into the session
workspace (not the repo):
`<session>/files/b029/` → `identitytable.json` (former: ours + shadows; squad QIDs), `identity.json`
(58 same-label labels), `corpus_full.json` + `corpus.json` (90 unique news items), `shadowset.json` +
`shadowset_all.json` (the measured shadow sets), `squadshadow.json`, `squadqids2.txt`,
`squad_fogis.txt`, `squadnames.json`, and `b029/{run.sh,q1.sparql,q1.json}` (the SPARQL helper used
for the shadow query — **read this before writing the runtime query**).

Other scratch (SPARQL variants, browser dumps, one-off `.ts` probes) was deleted and is reproducible
from the queries quoted in this document.

**Environment:** Linux, Node v20.20.2, npm 10.8.2, vitest 3.2.7, `npx tsx` available (top-level await
NOT supported — wrap in `async function main()`), Playwright. `gh` CLI authenticated as
`danielomazarino` with `repo` + `workflow` scopes. forzafootball.com 403s both curl and the browser —
use `https://r.jina.ai/<url>`.

## 9. COMMIT HISTORY (context)

**Production state at handoff:** served `app.json` sha256 `ffabcc71…` == committed; build `4445006.83b59d0`;
36 news items (32 `men`, 4 `former`). The Kalmar/Ohlsson article is **still present** in the served feed —
it will only disappear once B-029 is implemented **and** the data is regenerated.

`4445006` data → `e26e15c` B-028 follow-up (surname capitalization) → `6e0e2d5` data →
`9b66dcc` **B-028** (capitalization-aware different-person guard + `casedEvidenceText` + `ciPattern`/
`capitalizedPattern` + slug as a separate match surface) → `ee30416` data → `abb424e` B-027 (possessive
different-person guard) → `2bfcb51` B-026 (archived stale handover) → `1a7ab32` B-024/B-025 (entity
decoding, en-dash score guard, duplicate body) → `03dc392` data.

B-021…B-028 were all the SAME defect in different clothes: a squad player's surname is also a word, a
common surname, or another person's name. Every fix added a guard recognising a *competing* name →
whack-a-mole. **B-029 replaces the pattern with a computed identity layer.**
