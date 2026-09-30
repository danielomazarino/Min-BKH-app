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
| **B-004** | OPEN — **UNVALIDATED** | Prompt fixed (`c73b820`) + offline test green, but the one authorised live eval returned **HTTP 503** (run `36747767583`). Transport failure, **no semantic verdict**. Gemini stays disabled |
| **E-005** | Code deployed, **data pending** | Pushed `05a9d21`, deploy run `36689400880` green. Data effect owed after the 2026-10-01 nightly |
| **N-001a** | OPEN | `MatchDetail.playerStats` declared, never populated. No inferred stats, ever |
| **N-001b** | OPEN | Needs physical iPhone 13 verification. **Automation cannot close this** |
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
