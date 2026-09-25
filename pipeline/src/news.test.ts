import { describe, expect, it } from "vitest";
import { classifyNews, menRelevantNews, isClubPromotional } from "./classify";
import { dedupeNews, normalizeTitle, canonicalUrl } from "./dedupe";
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
});
