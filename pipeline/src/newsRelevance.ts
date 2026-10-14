/**
 * Entity/relation-aware news relevance engine.
 *
 * Replaces the old generic-keyword classifier where words like "klubb" or
 * "förening" were treated as BK Häcken relevance. Now an article must have an
 * actual relationship to BK Häcken:
 * - source is the official club feed (source-level relevance), OR
 * - explicit Häcken mention in title/summary, OR
 * - mention of a known Häcken person (current squad or verified former player)
 *   in a Häcken context.
 *
 * Relevance classes: CURRENT_HACKEN | FORMER_PLAYER | GENERAL_ALLSVENSKAN |
 * UNRELATED | UNKNOWN.
 */
import type { NewsCategory, NewsItem } from "./types";

export type Relevance = "CURRENT_HACKEN" | "FORMER_PLAYER" | "GENERAL_ALLSVENSKAN" | "UNRELATED" | "UNKNOWN";

/** Words that are NEVER sufficient evidence of a Häcken relationship. */
const GENERIC_WORDS = ["klubb", "förening", "medlem", "fotboll", "fotbollsklubben", "spelare", "lag"];
void GENERIC_WORDS;

/** Official club source — its metadata establishes relevance by itself. */
const OFFICIAL_SOURCES = ["BK Häcken"];
void OFFICIAL_SOURCES;

/** Competition channel — official but covers the whole league. */
const COMPETITION_SOURCES = ["Allsvenskan"];
void COMPETITION_SOURCES;

/** Secondary media sources — require an explicit Häcken relation. */
const SECONDARY_SOURCES = ["Sportbladet", "Expressen", "SVT Sport", "Bollsvenskan"];
void SECONDARY_SOURCES;

/** Current squad names + well-known Häcken persons (normalized). */
export interface KnownPersons {
  currentPlayers: string[];
  /**
   * Known former players. Optional since 2026-09-26: the hand-curated
   * registry was retired, and news relevance must NOT depend on a closed list
   * of former players — an article about a former Häcken player we do not
   * happen to know is still a Häcken article, and dropping the field keeps
   * relevance working for every player rather than the 31 we remembered.
   */
  formerPlayers?: string[];
  staff?: string[];
  /** Known women's-team players — their presence marks an article as women's. */
  womenPlayers?: string[];
  /** Known women's-team opponents/competitions (Damallsvenskan clubs etc.). */
  womenContextTerms?: string[];
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * The URL slug turned into matchable words.
 *
 * WHY (measured 2026-10-09): on the Fotbolltransfers club feed the SUBJECT of
 * the article is in the URL slug, not the title —
 *   title: "Öppnar för flytt inom Allsvenskan"
 *   slug:  mikkel-rygaard-oppnar-for-flytt-inom-allsvenskan
 * The slug names "Mikkel Rygaard"; the title names nobody. Matching
 * title+summary alone found 7 of 20 live items; adding the slug found 11.
 *
 * The slug is ASCII-fied (å/ä→a, ö→o), lowercase and hyphen-separated, so it
 * is normalised the same way as every other text (norm()) before matching. The
 * trailing numeric article id is dropped. This is a MATCH surface only: no name
 * is ever harvested from it into a list.
 */
export function slugText(url: string): string {
  if (!url) return "";
  const clean = url.split(/[?#]/)[0];
  const parts = clean.split("/").filter(Boolean);
  let last = parts[parts.length - 1] ?? "";
  if (/^\d+$/.test(last)) last = parts[parts.length - 2] ?? "";
  return last.replace(/[-_]+/g, " ");
}

/**
 * ALL evidence text an article offers, concatenated for matching.
 *
 * Single source of truth on purpose: `mentionsHäcken`, `matchKnownMan` and the
 * women's-context check must all see the SAME text, or a Häcken mention could
 * be found in the body while a player name was looked for only in the title.
 *
 * Included, strongest first: title, summary, URL slug, article body.
 */
function evidenceText(item: {
  title?: string;
  summary?: string;
  url?: string;
  bodyText?: string;
}): string {
  return norm(
    // Joined with a SEPARATOR, not a space: the different-person guard reads
    // two-word pairs ("<first> <surname>"), and a plain-space join created
    // phantom pairs across field boundaries — title "… i truppen" + summary
    // "Rygaard missade …" produced "truppen rygaard", which read as a person
    // named "Truppen Rygaard". A period is a word boundary for \b but cannot
    // be part of a name pair.
    [item.title ?? "", item.summary ?? "", slugText(item.url ?? ""), item.bodyText ?? ""].join(" . "),
  );
}

/** Explicit Häcken mention in relevant context. */
export function mentionsHäcken(
  title: string,
  summary: string,
  extra?: { url?: string; bodyText?: string },
): boolean {
  // norm() strips diacritics, so "häcken" becomes "hacken" — match the
  // normalized form. "hackens?" also covers the possessive form "Häckens"
  // (e.g. "Häckens CL-premiär"), which \bhacken\b alone rejected.
  const text = evidenceText({ title, summary, url: extra?.url, bodyText: extra?.bodyText });
  return /\bhackens?\b/.test(text) || /\bbk ?hackens?\b/.test(text);
}

/**
 * The name parts usable for surname-only matching, in the order to try them.
 *
 * WHY EVERY TOKEN AFTER THE FIRST, NOT JUST THE LAST (measured 2026-10-08)
 * ------------------------------------------------------------------------
 * The squad lists "Mikkel Rygaard Jensen", but the press — and Wikidata, and
 * the player himself — use "Mikkel Rygaard". Taking the LAST token as the
 * surname yielded "Jensen", so every "Rygaard …" headline matched nothing and
 * several real articles were dropped as "no Häcken relation" (confirmed on
 * Fotbollstidningar/GP: "Rygaard om Häckens väntan", "Rygaards gläds över
 * transfern"). The same failure hit "Sabri Dahari Kondo" (Kondo), "Bamir
 * Fierza Sadiku" (Sadiku) and "Wilson Lindberg Uhrström" (Uhrström).
 *
 * MIDDLE tokens get a longer minimum (5 chars, vs 4 for the final token)
 * because a middle name is more likely to be a given name: "Christ Ivan Wawa"
 * must not make every article about a person called Ivan a Häcken article.
 *
 * There is deliberately NO blocklist of "ambiguous" surnames here. An earlier
 * version maintained one (common Swedish words + top-20 surnames), but it was
 * whack-a-mole: every new squad player with a common surname was a future
 * false positive (chef Marcus Samuelsson → Olle Samuelsson, women's NT Hanna
 * Lundkvist → Adam Lundkvist, Hammarby's sales chief Thomas Lindgren →
 * Gustav Lindgren — all three on the SAME night, 2026-10-13), and every
 * addition risked silently dropping real Häcken news. The structural fix
 * lives in `mentionsKnownPerson` instead: a surname-only match is rejected
 * when the article names a DIFFERENT full person with the same surname —
 * see the pass-2 comment there. Works for every surname, present or future.
 */
function surnameCandidates(normalizedName: string): string[] {
  const parts = normalizedName.split(" ").filter(Boolean);
  if (parts.length < 2) return [];
  const after = parts.slice(1);
  return after.filter((t, i) => {
    const isLast = i === after.length - 1;
    return t.length >= (isLast ? 4 : 5);
  });
}

/**
 * Does the article mention a known Häcken person by name?
 *
 * `surnameOnly` (default true) allows a surname-only match, which headlines
 * often use ("Falk utvisad", "Rygaard om Häckens väntan"). It is safe for the
 * CURRENT squad — 27 club-verified names — but NOT for the former-player list.
 *
 * WHY FORMER PLAYERS REQUIRE A FULL NAME (measured 2026-10-09)
 * -----------------------------------------------------------
 * The former-player list is ~294 names from Wikidata, and surname-only matching
 * against it produced real false positives in a live run:
 *   - "VM 94-hjälten Roger Ljung skiljer sig" matched former player Jesper Ljung
 *   - "Britt-Marie Mattsson: Trump bjuder in Putin…" matched Jesper Mattsson
 *   - "Silas Andersen: Jag skulle älska det" matched Niklas Andersen
 * Common Swedish/Danish surnames collide constantly at that list size, so a
 * former player must be named in full. A surname-only mention of a former
 * player is missed — the conservative trade-off, because showing hockey and
 * celebrity news is worse than missing an occasional surname-only headline.
 */
export function mentionsKnownPerson(
  title: string,
  summary: string,
  persons: string[],
  opts: { surnameOnly?: boolean; url?: string; bodyText?: string } = {},
): string | null {
  const surnameOnly = opts.surnameOnly ?? true;
  const text = evidenceText({ title, summary, url: opts.url, bodyText: opts.bodyText });

  // PASS 1 — full-name matches, across EVERY person, before any surname match.
  //
  // WHY TWO PASSES (measured 2026-10-09): "Officiellt: AZ Alkmaar säljer
  // Ibrahim Sadiq" is about the FORMER player Ibrahim Sadiq, but a single
  // pass reached squad player "Harun Ibrahim" first and matched on the shared
  // surname "Ibrahim" — attributing the article to the wrong person. A full
  // name is strictly stronger evidence than a surname, so it must win even
  // when the surname match appears earlier in the list.
  for (const p of persons) {
    const key = norm(p);
    if (key.length < 4) continue;
    if (text.includes(key)) return p;
  }

  if (!surnameOnly) return null;

  // PASS 2 — surname-only match, with a STRUCTURAL different-person guard.
  //
  // Headlines often use just the surname ("Rygaard om Häckens väntan"), and
  // word-boundary matching (with an optional possessive "s" so "Rygaards
  // gläds …" matches too) finds them. Substring matching is deliberately NOT
  // used: "Lindelöf" contains "linde", "Ibrahimovic" contains "ibrahim".
  //
  // THE GUARD (2026-10-14 — replaces the old AMBIGUOUS_SURNAMES blocklist,
  // which was whack-a-mole): a bare surname is accepted UNLESS the article
  // itself names a DIFFERENT full person with that same surname — i.e. the
  // text contains "<first> <surname>" where <first> is none of this
  // player's own name tokens. Every measured false positive has this shape:
  //   "Marcus Samuelsson" (chef)  vs squad player Olle Samuelsson
  //   "Hanna Lundkvist" (women NT) vs squad player Adam Lundkvist
  //   "Thomas Lindgren" (Hammarby) vs squad player Gustav Lindgren
  //   "Viktor Andersson" (GK)      vs squad player David Andersson
  //   "Roger Ljung" (VM-94 hero)   vs former player Jesper Ljung
  // and every measured true positive lacks it — the article uses the bare
  // surname only ("Rygaard om Häckens väntan", "Sadiku tillbaka i träning").
  // The guard needs no surname knowledge at all, so it works for any player
  // the squad will ever list, and it also covers the former-player list,
  // which previously needed its own stricter rule.
  //
  // `<first>` is excluded when it is one of the player's OWN tokens ("Mikkel
  // Rygaard" is the press form of "Mikkel Rygaard Jensen", not another
  // person), when it ends in "s" (a possessive or genitive — "Häckens
  // Rygaard" means OUR Rygaard), or when it is a Swedish function word
  // ("till Rygaard", "och Sadiku" — grammar, not a name). The function-word
  // list is CLOSED — Swedish grammar does not grow — which is what separates
  // it from the open surname list it replaces.
  for (const p of persons) {
    const key = norm(p);
    if (key.length < 4) continue;
    const tokens = key.split(" ");
    for (const surname of surnameCandidates(key)) {
      if (!new RegExp(`\\b${surname}s?\\b`).test(text)) continue;
      // The surname appears. Does the text also name a DIFFERENT person
      // with it? If so, this player's surname match is not evidence.
      const pairRe = new RegExp(`\\b([a-zåäöéü0-9]+) ${surname}\\b`, "g");
      let conflicted = false;
      for (const m of text.matchAll(pairRe)) {
        const first = m[1];
        if (tokens.includes(first)) continue; // the player's own name
        // A first token ending in "s" is NOT automatically a possessive:
        // Marcus, Thomas, Anders, Mats and Niklas all end in s, and "Marcus
        // Samuelsson" was exactly one of the false positives this guard
        // exists for. Only a club/football noun in possessive form
        // ("Häckens Rygaard" = OUR Rygaard) is excluded, from the closed
        // POSSESSIVE_CLUB_WORDS set below.
        if (first.endsWith("s") && POSSESSIVE_CLUB_WORDS.has(first)) continue;
        if (FUNCTION_WORDS.has(first)) continue; // grammar, not a name
        conflicted = true; // a different "<first> <surname>" person is named
        break;
      }
      if (conflicted) continue;
      return p;
    }
  }
  return null;
}

/**
 * Club/football nouns in possessive form — a CLOSED list. "Häckens Rygaard"
 * means OUR Rygaard, so such a pair must not read as a different person
 * named "Häckens". Deliberately narrow: a first token ending in "s" is only
 * a possessive when it is one of these football nouns — Marcus, Thomas,
 * Anders and Mats are NAMES that end in s, and "Marcus Samuelsson" is
 * precisely the different-person evidence this guard exists to catch.
 */
// Stored NORMALIZED (norm() strips å/ä/ö → a/a/o): the text is always
// normalized before matching, so "Häckens" arrives here as "hackens".
const POSSESSIVE_CLUB_WORDS = new Set([
  "hackens", "klubbens", "lagets", "truppens", "tranarens", "matchens",
  "sasonens", "bravidas", "guldfagelns", "publikens", "supportrarnas",
  "anfallarens", "mittfaltarens", "backens", "malvaktens", "kaptens",
]);

/**
 * Swedish function words — a CLOSED list. Used only to stop the
 * different-person guard from reading grammar ("till Rygaard") as a first
 * name. Unlike the surname list it replaces, this can never need maintenance:
 * Swedish function words are fixed by the language, not by who plays for us.
 */
const FUNCTION_WORDS = new Set([
  "i", "på", "av", "för", "till", "mot", "med", "om", "efter", "före", "under",
  "över", "vid", "från", "hos", "ur", "ut", "in", "att", "den", "det", "de",
  "dem", "en", "ett", "och", "eller", "men", "som", "är", "var", "har", "ha",
  "hade", "inte", "också", "ju", "väl", "nu", "så", "men", "när", "då",
  "sin", "sitt", "sina", "hans", "hennes", "deras", "vår", "vår", "er",
  "jag", "du", "han", "hon", "vi", "ni", "de", "man", "kvar", "mer", "mest",
]);

/** Is the article about Allsvenskan generally (not Häcken-specific)? */
export function isGeneralAllsvenskan(
  title: string,
  summary: string,
  extra?: { url?: string; bodyText?: string },
): boolean {
  const text = evidenceText({ title, summary, url: extra?.url, bodyText: extra?.bodyText });
  return /allsvenskan/.test(text) && !mentionsHäcken(title, summary, extra);
}

/**
 * Match a known Häcken man, applying the right strictness per list.
 *
 * Current squad (27 club-verified names): surname-only is allowed, because
 * headlines routinely use just the surname and the list is small enough that
 * collisions are rare.
 *
 * Former players (~294 Wikidata names): FULL NAME ONLY. Surname-only matching
 * at that size produced real false positives in a live run (Roger Ljung →
 * Jesper Ljung, Britt-Marie Mattsson → Jesper Mattsson, Silas Andersen →
 * Niklas Andersen). See `mentionsKnownPerson`.
 *
 * Returns the matched name and whether it is a current squad member.
 */
function matchKnownMan(
  title: string,
  summary: string,
  known: KnownPersons,
  extra?: { url?: string; bodyText?: string },
): { person: string; isCurrent: boolean } | null {
  // PASS 1 — FULL NAME across BOTH lists, before any surname match.
  //
  // Order matters: "Officiellt: AZ Alkmaar säljer Ibrahim Sadiq" names the
  // former player Ibrahim Sadiq, but a surname pass over the current squad
  // would match "Harun Ibrahim" on the shared surname "Ibrahim" first. A full
  // name is strictly stronger evidence, so it must win across the whole set.
  const currentFull = mentionsKnownPerson(title, summary, known.currentPlayers, { surnameOnly: false, ...extra });
  if (currentFull) return { person: currentFull, isCurrent: true };
  const formerFull = mentionsKnownPerson(title, summary, known.formerPlayers ?? [], { surnameOnly: false, ...extra });
  if (formerFull) return { person: formerFull, isCurrent: false };

  // PASS 2 — surname-only, CURRENT SQUAD ONLY. The 27 club-verified names are
  // safe for this; the ~294 former names are not (see mentionsKnownPerson).
  const currentSurname = mentionsKnownPerson(title, summary, known.currentPlayers, extra);
  if (currentSurname) return { person: currentSurname, isCurrent: true };

  return null;
}

export interface NewsRelevanceResult {
  relevance: Relevance;
  category: NewsCategory;
  /** Why this classification was reached (for provenance/debug). */
  reason: string;
  /** Matched person, if any. */
  matchedPerson?: string;
}

/**
 * Classify one article's relationship to BK Häcken men.
 *
 * Rules:
 * - Official club source → CURRENT_HACKEN (source metadata establishes relation).
 *   But still demote to women/youth if explicit women/youth context.
 * - Secondary sources require explicit Häcken mention or a known Häcken person.
 * - Generic words (klubb, förening, medlem) are NEVER sufficient.
 * - Allsvenskan without Häcken mention → GENERAL_ALLSVENSKAN.
 */
export function classifyRelevance(
  item: Pick<NewsItem, "title" | "summary" | "publisher"> &
    Partial<Pick<NewsItem, "url" | "bodyText" | "clubScoped">>,
  known: KnownPersons,
): NewsRelevanceResult {
  const title = item.title ?? "";
  const summary = item.summary ?? "";
  const publisher = item.publisher ?? "";
  const url = item.url ?? "";
  const bodyText = item.bodyText ?? "";
  const extra = { url, bodyText };

  // Women's/youth context always wins over men's relevance.
  const text = evidenceText({ title, summary, url, bodyText });
  const womenContext =
    /damallsvenskan|damlaget|damerna|damfotboll|kvinnor|obs dam|kvinnlig|women'?s champions league|women'?s super league/i.test(text) ||
    // Known women's-team players are strong women's evidence (e.g. Jennifer Falk).
    mentionsKnownPerson(title, summary, known.womenPlayers ?? [], extra) !== null ||
    (known.womenContextTerms ?? []).some((t) => text.includes(norm(t)));
  const youthContext = /akademi|u19|u17|pojkar|flickor|junior|p05|p07/.test(text);

  // 1) Official club source: relevance established by source metadata.
  if (publisher === "BK Häcken") {
    if (womenContext) return { relevance: "UNRELATED", category: "women", reason: "official source but women's context" };
    if (youthContext) return { relevance: "UNRELATED", category: "youth", reason: "official source but youth context" };
    return { relevance: "CURRENT_HACKEN", category: "men", reason: "official club source" };
  }

  // 2) Explicit Häcken mention in relevant context.
  if (mentionsHäcken(title, summary, extra)) {
    if (womenContext) return { relevance: "UNRELATED", category: "women", reason: "Häcken mention but women's context" };
    const match = matchKnownMan(title, summary, known, extra);
    if (match) {
      // A former player named in a Häcken article is FORMER_PLAYER, not
      // CURRENT_HACKEN — the UI tags it "Former player".
      return {
        relevance: match.isCurrent ? "CURRENT_HACKEN" : "FORMER_PLAYER",
        category: "men",
        reason: `Häcken mention + known person: ${match.person}`,
        matchedPerson: match.person,
      };
    }
    if (publisher === "BK Häcken") {
      return { relevance: "CURRENT_HACKEN", category: "men", reason: "official club source" };
    }
    // A CLUB-SCOPED feed (Fotbolltransfers' /rss/klubbar/27) carries one men's
    // club's transfers and contracts and cannot carry women's news — verified
    // 2026-10-09: 20/20 live items mention Häcken in the body, 0 mention "dam",
    // and Fotbolltransfers lists no women's league. So for these items an
    // explicit Häcken mention is itself sufficient men's evidence, exactly as
    // the official club feed already is. Without this, club-finance and
    // contract-list stories ("Krävs för att BK Häcken ska fortsätta vara
    // konkurrenskraftiga", "LISTA: Kontraktsläget i BK Häcken") were dropped as
    // "no men's evidence — could be women's team".
    //
    // This replaces ONLY the `menMarker` requirement below, never the Häcken
    // mention requirement above — the scope argument proves the club is men's,
    // it does not prove the mention is about the club's men's team by itself.
    if (item.clubScoped) {
      // The youth veto is applied here for the same reason the official-source
      // branch applies it: a club-scoped feed can still carry academy news, and
      // "Häcken akademi … Pojkarna U17" must not become men's-team news merely
      // because the feed is the club's. (Caught by test before shipping.)
      if (youthContext) return { relevance: "UNRELATED", category: "youth", reason: "club-scoped feed but youth context" };
      return { relevance: "CURRENT_HACKEN", category: "men", reason: "club-scoped feed + Häcken mention" };
    }
    // Secondary source with Häcken mention but NO men's evidence (no known
    // men's player, no men's competition marker). The Häcken mention alone
    // cannot distinguish men's from women's team — be conservative.
    const menMarker = /allsvenskan(?!\s*dam)|herr(?:ar|lag)?\b|svenska cupen herr/i.test(text);
    if (!menMarker) {
      return {
        relevance: "UNKNOWN",
        category: "unknown",
        reason: "Häcken mention but no men's evidence — could be women's team",
      };
    }
    return { relevance: "CURRENT_HACKEN", category: "men", reason: "Häcken mention + men's competition marker" };
  }

  // 3) Known Häcken person without explicit club mention (e.g. transfer story).
  //
  // The women/youth veto is re-checked here, and it MUST be: branches 1 and 2
  // both apply it, but this branch did not, so an article naming a men's
  // player inside a women's context was returned CURRENT_HACKEN — directly
  // contradicting this function's own contract ("women's/youth context always
  // wins over men's relevance"). It was unreachable from production while the
  // prefilter ignored known-person matching; wiring the prefilter to reuse
  // this branch made it reachable, so the gap is closed here rather than
  // worked around in the caller.
  const match = matchKnownMan(title, summary, known, extra);
  if (match) {
    if (womenContext) {
      return { relevance: "UNRELATED", category: "women", reason: `women's context overrides known person: ${match.person}`, matchedPerson: match.person };
    }
    if (youthContext) {
      return { relevance: "UNRELATED", category: "youth", reason: `youth context overrides known person: ${match.person}`, matchedPerson: match.person };
    }
    return {
      relevance: match.isCurrent ? "CURRENT_HACKEN" : "FORMER_PLAYER",
      category: "men",
      reason: `known Häcken person: ${match.person}`,
      matchedPerson: match.person,
    };
  }

  // 4) General Allsvenskan coverage — related to the league, not to Häcken.
  if (isGeneralAllsvenskan(title, summary, extra)) {
    return { relevance: "GENERAL_ALLSVENSKAN", category: "men", reason: "Allsvenskan without Häcken relation" };
  }

  // 5) Everything else — including articles that only say "klubb" — UNRELATED.
  return { relevance: "UNRELATED", category: "unknown", reason: "no Häcken relationship established" };
}

/** Convenience: keep only articles relevant to current BK Häcken men. */
export function currentHackenNews<T extends { publisher: string; title: string; summary?: string }>(
  items: T[],
  known: KnownPersons,
): T[] {
  return items.filter((it) => classifyRelevance({ ...it, summary: it.summary ?? "" }, known).relevance === "CURRENT_HACKEN");
}