import { describe, expect, it } from "vitest";
import { classifyNews, menRelevantNews, isClubPromotional, isExplicitlyWomenTeam } from "./classify";
import { dedupeNews, normalizeTitle, canonicalUrl } from "./dedupe";
import { buildNewsEvents } from "./newsEvents";
import { classifyRelevance } from "./newsRelevance";
import { extractSourceTags } from "./articleText";
import type { NewsItem } from "./types";

function news(overrides: Partial<NewsItem>): NewsItem {
  return {
    id: "x",
    title: "T",
    url: "https://example.com/a",
    publishedAt: "2026-09-20T10:00:00Z",
    publisher: "BK Häcken",
    category: "unknown",
    discoveredVia: "rss",
    ...overrides,
  };
}

describe("news classification", () => {
  it("classifies HERR-tagged article as men", () => {
    expect(classifyNews("Gustav Lindgren: bra från start", "BK Häcken tog 5–0 mot Kalmar FF i Allsvenskan")).toBe("men");
  });

  it("classifies dam article as women", () => {
    expect(classifyNews("Tuff Champions League-premiär mot Inter", "Damerna spelade i Damallsvenskan-context.")).toBe("women");
  });

  it("classifies women's player interview as women", () => {
    expect(classifyNews("Europaspecial – lär känna Laney Egbuka", "Intervju inför Champions League.")).toBe("women");
  });

  it("classifies academy article as youth", () => {
    expect(classifyNews("Akademin Queens Cup", "U19-laget spelar bra.")).toBe("youth");
  });

  it("classifies club-wide content as club", () => {
    expect(classifyNews("Årsmötet 2026", "Föreningen bjuder in till årsmöte.")).toBe("club");
  });

  it("does not invent men's relevance for unknown content", () => {
    expect(classifyNews("Ny huvudpartner presenteras", "Avtal tecknas.")).toBe("club");
  });

  it("menRelevantNews includes men and genuine club items but filters promotional", () => {
    const items = [
      news({ id: "1", title: "Herrnyhet", category: "men" }),
      news({ id: "2", title: "Årskort 2027", category: "club" }),
      news({ id: "3", title: "Klubbinformation", category: "club" }),
      news({ id: "4", title: "Damnyhet", category: "women" }),
    ];
    const out = menRelevantNews(items);
    expect(out.map((n) => n.id)).toEqual(["1", "3"]);
  });

  it("isClubPromotional detects tickets/shop/partners", () => {
    expect(isClubPromotional("Biljettinformation inför matchen")).toBe(true);
    expect(isClubPromotional("Matchtruppen mot Kalmar")).toBe(false);
  });
});

/**
 * The men's news section is a POSITIVE set. An article qualifies only when the
 * SOURCE says "Herr", or when it is demonstrably men's-team content. An
 * explicit "Dam" label always wins, whatever the text says.
 */
describe("authoritative BK Häcken source classification", () => {
  // A. Explicit "Dam" is excluded from the men's set.
  it("A: sourceTags ['Dam'] is classified women's and excluded from men's news", () => {
    const title = "Tuff Champions League-premiär mot Inter";
    const summary = "Champions League-premiären slutade 0–1.";
    expect(classifyNews(title, summary, ["Dam"])).toBe("women");
    const item = news({ id: "dam", title, summary, sourceTags: ["Dam"], category: "women" });
    expect(menRelevantNews([item])).toEqual([]);
    expect(isExplicitlyWomenTeam(item)).toBe(true);
  });

  // B. "Herr" is eligible, subject to the normal relevance rules.
  it("B: sourceTags ['Herr'] is classified men's and is eligible", () => {
    const title = "Gustav Lindgren: kändes väldigt bra från första minuten";
    const summary = "BK Häcken tog 5–0 mot Kalmar FF i Allsvenskan.";
    expect(classifyNews(title, summary, ["Herr"])).toBe("men");
    const item = news({ id: "herr", title, summary, sourceTags: ["Herr"], category: "men" });
    expect(menRelevantNews([item]).map((n) => n.id)).toEqual(["herr"]);
  });

  // C. Non-team labels are general club content — never "women", never "men".
  it("C: sourceTags ['Hållbarhet','Föreningen'] is club content, not women's", () => {
    const title = "Gåfotboll med BK Häcken – för hälsan och glädjens skull";
    const summary = "Möt deltagarna på Slätta Damm och ta del av gemenskapen.";
    const c = classifyNews(title, summary, ["Hållbarhet", "Föreningen"]);
    expect(c).toBe("club");
    expect(c).not.toBe("women");
  });

  // D. The bare substring "dam" must never imply women's football.
  it("D: 'Slätta Damm' in title/summary/URL is not a women's signal", () => {
    const tags = ["Hållbarhet", "Föreningen"];
    const title = "Gåfotboll med BK Häcken – för hälsan och glädjens skull";
    const summary = "Möt deltagarna på Slätta Damm.";
    expect(classifyNews(title, summary, tags)).toBe("club");
    // No authoritative label at all: still not women's football.
    expect(classifyNews(title, summary, [])).not.toBe("women");
    // The word must not be readable as a standalone team word either.
    expect(classifyNews("Slätta Damm inviterar", "Gåfotboll på Slätta Damm.", [])).not.toBe("women");
  });

  // E. A locally classified women's article cannot reach the men's set.
  it("E: category 'women' without source tags is still excluded", () => {
    const item = news({ id: "w", title: "Damlaget spelar", category: "women" });
    expect(menRelevantNews([item])).toEqual([]);
  });

  // F. A known men's-team article is still included.
  it("F: known men's-team article is still included", () => {
    const item = news({
      id: "m",
      title: "BK Häcken åker till Kalmar – här är matchtruppen",
      summary: "Matchtruppen inför bortamatchen i Allsvenskan.",
      category: "men",
      sourceTags: ["Herr"],
    });
    expect(menRelevantNews([item]).map((n) => n.id)).toEqual(["m"]);
  });

  // G. The real Women's Champions League ticket article is excluded.
  it("G: women's Champions League article tagged Dam is excluded", () => {
    const item = news({
      id: "wcl",
      title: "Biljettsläpp till hemmamatcherna i Champions Leauge",
      summary: "Biljetter till Champions League-hemmamatcher.",
      sourceTags: ["Dam"],
      category: "women",
    });
    expect(menRelevantNews([item])).toEqual([]);
  });

  // H. The community article is excluded from the men's team news, and is
  // NOT classified as women's football.
  it("H: Slätta Damm community article is excluded from men's news but not women's", () => {
    const title = "Gåfotboll med BK Häcken – för hälsan och glädjens skull";
    const item = news({
      id: "c",
      title,
      summary: "Möt deltagarna på Slätta Damm.",
      sourceTags: ["Hållbarhet", "Föreningen"],
      category: "club",
    });
    expect(menRelevantNews([item])).toEqual([]);
    expect(item.category).toBe("club");
  });

  // I. Untagged external men's articles keep the existing fallback behaviour.
  it("I: untagged external men's article still passes the gate", () => {
    const item = news({
      id: "ext",
      title: "Häcken krossar Kalmar",
      summary: "Allsvenskanmatch mot Kalmar FF.",
      publisher: "Sportbladet",
      category: "men",
    });
    expect(menRelevantNews([item]).map((n) => n.id)).toEqual(["ext"]);
  });
});

describe("source tag extraction", () => {
  function page(...badges: string[]): string {
    const blocks = badges
      .map(
        (b) =>
          `<span data-livewire-v2-component="category-badge" class="inline-flex" style="background-color:#111"><span>${b}</span></span>`,
      )
      .join("");
    return `<html><body><h1>Rubrik</h1>${blocks}</body></html>`;
  }

  it("reads every rendered category badge, in order", () => {
    expect(extractSourceTags(page("Herr"))).toEqual(["Herr"]);
    expect(extractSourceTags(page("Dam"))).toEqual(["Dam"]);
    expect(extractSourceTags(page("Hållbarhet", "Föreningen"))).toEqual(["Hållbarhet", "Föreningen"]);
  });

  it("returns nothing when a page has no badges", () => {
    expect(extractSourceTags("<html><body><p>Ingen badge</p></body></html>")).toEqual([]);
  });

  it("does not invent a team label from a place name in the body", () => {
    const html = `<html><body><h1>Gåfotboll på Slätta Damm</h1><p>damallsvenskan nämns i texten</p></body></html>`;
    expect(extractSourceTags(html)).toEqual([]);
  });
});

describe("news deduplication", () => {
  it("dedupes on canonical URL", () => {
    const a = news({ id: "1", url: "https://example.com/a?utm=x" });
    const b = news({ id: "2", url: "https://example.com/a" });
    expect(dedupeNews([a, b])).toHaveLength(1);
  });

  it("groups same normalized title within 3 days into one event (keeps both sources)", () => {
    const a = news({ id: "1", title: "Häcken vinner mot Kalmar", publishedAt: "2026-09-20T10:00:00Z", url: "https://a.com/1" });
    const b = news({ id: "2", title: "Häcken vinner mot Kalmar", publishedAt: "2026-09-21T10:00:00Z", url: "https://b.com/2" });
    const out = dedupeNews([a, b]);
    // Event-level dedup: both articles survive with a shared dedupeKey so
    // buildNewsEvents can merge them into one event with two source pills.
    expect(out).toHaveLength(2);
    expect(out[0].dedupeKey).toBe(out[1].dedupeKey);
  });

  it("keeps same title outside the date window", () => {
    const a = news({ id: "1", title: "Häcken vinner mot Kalmar", publishedAt: "2026-09-01T10:00:00Z", url: "https://a.com/1" });
    const b = news({ id: "2", title: "Häcken vinner mot Kalmar", publishedAt: "2026-09-20T10:00:00Z", url: "https://b.com/2" });
    expect(dedupeNews([a, b])).toHaveLength(2);
  });

  it("normalizes titles deterministically", () => {
    expect(normalizeTitle("Häcken — Vinner!")).toBe(normalizeTitle("häcken vinner"));
  });

  it("strips tracking params from URLs", () => {
    expect(canonicalUrl("https://example.com/a/?utm_source=x&id=1")).toBe("https://example.com/a");
  });

  it("same men's event from two publishers → one event with two sources, original URLs preserved", () => {
    const official = news({ id: "1", title: "Häcken vinner mot Kalmar", publisher: "BK Häcken", url: "https://bkhacken.se/nyhet/x", sourceRole: "primary" });
    const secondary = news({ id: "2", title: "Häcken vinner mot Kalmar", publisher: "Sportbladet", url: "https://www.aftonbladet.se/sportbladet/a/xyz", sourceRole: "secondary", publishedAt: "2026-09-21T10:00:00Z" });
    const events = buildNewsEvents(dedupeNews([official, secondary]));
    expect(events).toHaveLength(1);
    expect(events[0].sources).toHaveLength(2);
    const pubs = events[0].sources.map((s) => s.publisher);
    expect(pubs).toContain("BK Häcken");
    expect(pubs).toContain("Sportbladet");
    // Original URLs preserved per source.
    expect(events[0].sources.map((s) => s.url)).toContain("https://www.aftonbladet.se/sportbladet/a/xyz");
    // Firecrawl never becomes a publisher.
    expect(pubs).not.toContain("Firecrawl");
  });

  it("different events remain separate", () => {
    const a = news({ id: "1", title: "Häcken vinner mot Kalmar", url: "https://a.com/1" });
    const b = news({ id: "2", title: "Häcken förlorar mot Malmö", url: "https://b.com/2" });
    const events = buildNewsEvents(dedupeNews([a, b]));
    expect(events).toHaveLength(2);
  });

  it("women's event is excluded from men's feed by relevance filter", () => {
    // Covered in newsRelevance.test.ts; here we verify the pipeline filter shape:
    // an item classified UNRELATED (women) never reaches buildNewsEvents input.
    const women = news({ id: "3", title: "Falk utvisad i Häckens CL-premiär", publisher: "Sportbladet" });
    // Simulate the run.ts filter with women's identity present:
    const known = { currentPlayers: ["Gustav Lindgren"], formerPlayers: [], womenPlayers: ["Jennifer Falk"], womenContextTerms: [] };
    const r = classifyRelevance(women, known);
    expect(r.relevance === "CURRENT_HACKEN").toBe(false);
  });
});
