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

## Current state — 2026-09-30

> This snapshot can lag reality by hours. Before relying on it, check the live
> state yourself: `git log -1` for the current commit, `curl -s
> https://danielomazarino.github.io/Min-BKH-app/data/app.json | sha256sum` for
> the served data. Nothing below goes stale *on its own* — only this header's
> "as of" date does.

| | |
| --- | --- |
| App | Live at `danielomazarino.github.io/Min-BKH-app` |
| Current commit | `git log -1` — deliberately not hardcoded, because a hash here is stale the moment the next commit lands |
| Tests | **349 passing**, 0 failing |
| Data last generated | 2026-09-30 03:46 UTC |
| Tonight's data job | Runs ~03:45 UTC — regenerates tomorrow's content |

Commit hashes **are** used further down this file, but only for past events —
*"fixed in `c73b820`"*, *"run `36747767583` returned 503"*. Those are permanent
anchors to a specific change or a specific run, not live values, so they do not
rot. If a hash here ever appears as a *current* value rather than a past one,
treat it as suspect and re-check with `git log`.

---

## The three things that matter right now

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

## Open items, in plain language

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
   that exist for a few hours each.
2. **Report the drop breakdown in the nightly log** — 3 lines, and it would have
   made this diagnosable in minutes instead of a day. Currently only the total
   is printed.
3. **Only then** narrow the club-administration items.

**Do not widen the 45-day date window.** It is not the constraint; the constraint
is *when* we look, not *how far back*.

### DONE 2026-09-30 — added the Fotbolltransfers club feed

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

**Status:** OPEN, conditional on data availability

**What happens today.** Former players show name, position, seasons at the club
and where they are now. Photos, transfers, career detail, appearances, goals and
season statistics are absent.

**Why it is not simply a task.** Each field needs a source that is both
available and trustworthy. Where a reliable source does not exist, the field
stays empty rather than being approximated — the same principle as match
statistics above.

**Acceptance:** each field appears only when it comes from a citable source, with
the source recorded so any claim can be checked.

---

## Closed items — what supporters gained

| Item | What it was | Outcome |
| --- | --- | --- |
| **E-001** | The card-watching list was capped at 4 rows while claiming to show 5 | Shows every qualifying player |
| **E-002** | "1 caution left", "3 cautions", "suspended" all appeared separately and repetitively | Grouped into one clear state per player |
| **E-003** | A player who had left the club was counted as a current risk | Removed from the current count |
| **E-004** | Swiping down did nothing on real iPhones (works in emulators) | Works on real touch devices |
| **E-006 – E-009** | Former-player identity could be wrong or unsourced | Now resolved from live sources, with provenance recorded |
| **B-002** | News cards had no images | Feed supplies them |
| **B-005** | The overnight data job could finish successfully and never actually publish — data silently went stale for two days | Deploy guard now proves committed bytes match served bytes |

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
| **B-004** | OPEN — **UNVALIDATED** | Prompt fixed (`c73b820`) + offline test green. Every live eval returned **503**, which Google documents as *"temporarily overloaded"* — **not** size-related, so payload shrinking would not help. Nightly sampling in progress |
| **E-005** | Code deployed, **data pending** | Pushed `05a9d21`, deploy run `36689400880` green. Data effect owed after the 2026-10-01 nightly |
| **N-001a** | OPEN | `MatchDetail.playerStats` declared, never populated. No inferred stats, ever |
| **N-001b** | OPEN | Needs physical iPhone 13 verification. **Automation cannot close this** |
| **B-006** | OPEN — cause **measured** | News is 9 days stale, but **the prefilter is innocent**: of 66 drops, 65 are general football it correctly rejects. Feeds carry ~23 Häcken items at most, and the nightly samples them **once at 03:30 UTC**. Fix = fetch more often, not filter differently |
| E-001 – E-004 | DONE | Verified in code |
| E-006 – E-009 | DONE | Superseded by the Wikidata search redesign |
| B-002, B-005 | DONE | B-005's deploy guard ran and **passed** — do not reopen |

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

**The blocker is NOT capacity.** Auth and model availability are eliminated (run
`36493245277`: HTTP 200, model listed) and no 429 has ever been observed, so
quota is eliminated too. The remaining 503s are transient sector-wide capacity.
The **binding** blocker is the missing **validation**, not the request budget —
`gemini-budget-check.sh` guarantees ≤1 `generateContent` call, only after a free
metadata check, with no retry, no fallback and no loop.

**To close B-004:** one successful `gemini-semantic-eval.yml` run showing `t1`
grouped separately from `t3`–`t6`. Requires explicit human authorisation. Do not
spam re-runs; repeated 503s are what produced this repo's 84-request history.

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
| Is it quota? | **No** | 429 is a distinct code (`quota_exceeded`), never observed |
| Is it auth or model availability? | **No** | Distinct codes; eliminated by run `36493245277` (200, model listed) |
| Is it retryable? | **Yes** | `troubleshooting`: retry 503 with exponential backoff **plus jitter** |

### Why this session's data looked like a size effect, and why it was not

| run(s) | input | result |
| --- | --- | --- |
| `36749728598`, `36750319760` | ~0.3 KB | **200** ×2 |
| 12 × `semantic-eval` | ~23 KB | 503 |
| `36759857600` (chat probe) | **586 bytes** | 503 |
| `36763020541` (overnight, 2 samples) | 0.1 KB / 0.6 KB | 503, 503 |

The 586-byte request failing while a 0.3 KB request succeeded looked like proof
that input size was irrelevant. It was not proof of anything except that **503 is
random** — which is exactly what "temporarily overloaded" means. Thirteen
failures inside one afternoon is a property of the hour, not of the payload.

### One real finding that does matter

> *"Higher latency or token usage often occurs because Gemini 3.x models have
> thinking enabled by default."* — `gemini-3.8-flash` defaults to **medium**.

This repo **never sets `thinking_level`**, so every request runs medium thinking.
Setting `low` is the documented lever for cutting latency and token consumption.
It is **not** a fix for 503 — request shape does not change whether an overloaded
server accepts a request — so it must not be applied during a baseline
measurement.

### Measuring the only open question: time of day

Everything above is settled. The one thing still unknown is whether availability
varies by hour, and thirteen same-afternoon failures cannot answer it.

`gemini-overnight-availability.yml` samples **02:00, 04:00, 06:00, 08:00, 10:00
UTC** — two requests per run (availability + the chat question), 10 per night,
no retries. Held constant: same model, thinking left at the medium default,
`maxOutputTokens: 1024` to match the real eval request. Verified working by
manual dispatch (run `36763020541`, both steps executed, both 503).

It writes nothing and commits nothing — a nightly commit would trigger
`deploy.yml` on unchanged data.

### Honest limits of that measurement

Five samples is a small sample of a random variable. All-fail does not prove the
API is always down; all-succeed does not prove it is reliably up. It estimates a
duty cycle over one night, nothing more. **Read it as indicative, not proof.**

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
