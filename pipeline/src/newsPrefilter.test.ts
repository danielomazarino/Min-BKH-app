/**
 * The prefilter's person-rescue.
 *
 * THE DEFECT THIS PINS: `prefilterNews` kept an article only if it came from
 * the official feed or literally contained "Häcken"/"Häckens". Real Häcken
 * news that names a current player without ever saying "Häcken" was dropped —
 * among them the single most newsworthy item of the set, "Gustav Lindgren gör
 * hattrick mot Kalmar" (SVT Sport).
 *
 * The rescue REUSES `classifyRelevance`. That matters: it means the
 * conservative stances that file already enforces — women's context wins,
 * a Häcken mention with no men's evidence stays UNKNOWN, ambiguous surnames
 * never match on surname alone — carry over unchanged, and there is no second
 * person-matching system to drift out of sync.
 */
import { describe, expect, it } from "vitest";
import { prefilterNews, isHardExcluded } from "./newsPrefilter";
import type { KnownPersons } from "./newsRelevance";
import type { NewsItem } from "./types";

const NOW = new Date("2026-09-25T12:00:00Z");

const known: KnownPersons = {
  currentPlayers: ["Gustav Lindgren", "Abdoulaye Doumbia", "David Andersson"],
  womenPlayers: ["Jennifer Falk", "Disa Hellwig"],
  womenContextTerms: ["Vittsjö", "Damallsvenskan"],
};

function item(over: Partial<NewsItem> & { title: string }): NewsItem {
  return {
    id: "x",
    publisher: "SVT Sport",
    url: `https://example.com/${over.title.length}`,
    publishedAt: "2026-09-20T12:00:00.000Z",
    category: "unknown",
    discoveredVia: "rss",
    ...over,
  };
}

const kept = (items: NewsItem[], knownArg?: KnownPersons) =>
  prefilterNews(items, { now: NOW, known: knownArg }).candidates.map((c) => c.id);

describe("prefilterNews — person rescue", () => {
  it("keeps a known-current-player article that never says 'Häcken'", () => {
    // The reported false negative, verbatim.
    const hattrick = item({
      id: "hattrick",
      publisher: "SVT Sport",
      title: "Gustav Lindgren gör hattrick mot Kalmar",
    });
    expect(hattrick.title).not.toMatch(/Häcken/i);
    expect(kept([hattrick])).toEqual([]); // dropped WITHOUT `known` (old behaviour)
    expect(kept([hattrick], known)).toEqual(["hattrick"]); // kept WITH `known`
  });

  it("keeps a real NewsItem fixture for the SVT hattrick headline", () => {
    // Shaped exactly like the production item, so the test fails if the
    // headline or publisher drifts.
    const svt: NewsItem = {
      id: "t4",
      publisher: "SVT Sport",
      title: "Gustav Lindgren gör hattrick mot Kalmar",
      url: "https://www.svt.se/sport/fotboll/gustav-lindgren-gor-hattrick-mot-kalmar",
      publishedAt: "2026-09-20T12:00:00.000Z",
      category: "unknown",
      discoveredVia: "rss",
    };
    const res = prefilterNews([svt], { now: NOW, known });
    expect(res.candidates.map((c) => c.id)).toEqual(["t4"]);
    expect(res.dropped).toEqual([]);
  });

  it("keeps the Kalmar FF match preview that never says 'Häcken'", () => {
    // Publisher is the opponent, and the headline uses the abbreviation "KFF-BKH".
    const preview = item({
      id: "kalmar-preview",
      publisher: "Kalmar FF",
      title: "Inför KFF-BKH: Tillsammans ska vi göra allt vi kan för att ta tre poäng",
      summary: "Kalmar FF går in i matchen mot BK Häcken med fullt fokus.",
    });
    // The summary DOES say Häcken here, so the headline is not the only signal.
    expect(kept([preview], known)).toEqual(["kalmar-preview"]);

    // And with no Häcken anywhere, the known-player path is what rescues it.
    const noMention = item({
      id: "kalmar-preview-2",
      publisher: "Kalmar FF",
      title: "Inför KFF-BKH: Tillsammans ska vi göra allt vi kan",
      summary: "Gustav Lindgren är tillbaka i truppen.",
    });
    expect(kept([noMention], known)).toEqual(["kalmar-preview-2"]);
  });

  it("still drops an article naming a women's player", () => {
    // Deliberately contains NO "Häcken": the only route to being kept is the
    // new person-rescue, so this asserts the rescue does not bypass the
    // women's veto. ("Jennifer Falk viktig i Häckens seger" is ALSO kept by
    // the prefilter, but only because of the literal mention — the prefilter
    // has never done men/women discrimination, that is Gemini's job.)
    const womens = item({
      id: "women",
      publisher: "Sportbladet",
      title: "Jennifer Falk viktig i segern",
      summary: "Jennifer Falk scorede i damlagets match i Damallsvenskan.",
    });
    expect(womens.title).not.toMatch(/Häcken/i);
    expect(kept([womens], known)).toEqual([]);

    // A women's player who is ALSO a current men's name in the list must
    // still lose: women/youth context wins over men's relevance.
    const both = item({
      id: "both",
      publisher: "Sportbladet",
      title: "Gustav Lindgren på damlagets träning",
      summary: "Damlaget tränar inför Damallsvenskan.",
    });
    expect(kept([both], known)).toEqual([]);
  });

  it("still drops an article whose only match is an ambiguous surname", () => {
    // "David Andersson" is a squad goalkeeper; "Viktor Andersson" is not him.
    // Surname-only matching must never fire on "andersson".
    const stranger = item({
      id: "stranger",
      publisher: "Sportbladet",
      title: "Viktor Andersson bokar upp landslagskollen",
    });
    expect(kept([stranger], known)).toEqual([]);
  });

  it("still drops genuine non-Häcken noise", () => {
    const noise = item({ id: "noise", title: "Allsvenskan: Örgryte och Mjällby spelar inför omstart" });
    expect(kept([noise], known)).toEqual([]);
  });

  it("still drops advertisements and out-of-window items", () => {
    const ad = item({ id: "ad", publisher: "BK Häcken", title: "Köp årskort till säsongen" });
    expect(kept([ad], known)).toEqual([]);
    expect(isHardExcluded(ad)).toBe(true);

    const old = item({ id: "old", title: "Gustav Lindgren gör hattrick", publishedAt: "2020-01-01T00:00:00.000Z" });
    expect(kept([old], known)).toEqual([]);
  });

  it("behaves exactly as before when `known` is omitted", () => {
    const items: NewsItem[] = [
      item({ id: "a", publisher: "BK Häcken", title: "BK Häcken åker till Kalmar" }),
      item({ id: "b", publisher: "SVT Sport", title: "Gustav Lindgren gör hattrick mot Kalmar" }),
      item({ id: "c", publisher: "Sportbladet", title: "Häckens målvakter mot Juventus" }),
      item({ id: "d", publisher: "Sportbladet", title: "Viktor Andersson bokar upp landslagskollen" }),
      item({ id: "e", publisher: "Sportbladet", title: "Jennifer Falk viktig i Häckens seger" }),
      item({ id: "f", publisher: "Sportbladet", title: "Allsvenskan: Örgryte och Mjällby spelar inför omstart" }),
    ];
    const withNone = prefilterNews(items, { now: NOW });
    // Identical results — the optional field changes nothing when absent.
    expect(kept(items)).toEqual(withNone.candidates.map((c) => c.id));
    expect(kept(items, undefined)).toEqual(withNone.candidates.map((c) => c.id));
    // Old behaviour, stated exactly. "a" is the official source, "c" says
    // "Häckens", and "e" ALSO says "Häckens" — which is precisely why the
    // prefilter has never done men/women discrimination, and why the women's
    // stance is not asserted here without `known`.
    // Dropped: the known-player headline "b", the ambiguous surname "d",
    // and the league noise "f".
    expect(withNone.candidates.map((c) => c.id)).toEqual(["a", "c", "e"]);
  });

  it("increases candidates when `known` is supplied — that is the point", () => {
    const items = [
      item({ id: "a", publisher: "SVT Sport", title: "Gustav Lindgren gör hattrick mot Kalmar" }),
      item({ id: "b", publisher: "Sportbladet", title: "Abdoulaye Doumbia åter i truppen" }),
    ];
    expect(kept(items, known)).toHaveLength(2);
  });

  it("still honours the candidate cap, newest first", () => {
    const items = [
      item({ id: "old", title: "Gustav Lindgren gör hattrick", publishedAt: "2026-09-19T00:00:00.000Z" }),
      item({ id: "new", title: "Abdoulaye Doumbia åter i truppen", publishedAt: "2026-09-24T00:00:00.000Z" }),
    ];
    const res = prefilterNews(items, { now: NOW, known, maxItems: 1 });
    expect(res.candidates.map((c) => c.id)).toEqual(["new"]);
    expect(res.dropped.map((d) => d.reason)).toContain("over candidate cap");
  });
});
