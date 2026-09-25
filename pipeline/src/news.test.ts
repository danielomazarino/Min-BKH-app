import { describe, expect, it } from "vitest";
import { classifyNews, menRelevantNews, isClubPromotional } from "./classify";
import { dedupeNews, normalizeTitle, canonicalUrl } from "./dedupe";
import { buildNewsEvents } from "./newsEvents";
import { classifyRelevance } from "./newsRelevance";
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
