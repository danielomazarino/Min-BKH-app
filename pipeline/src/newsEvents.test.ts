import { describe, expect, it } from "vitest";
import { buildNewsEvents, publisherRole } from "./newsEvents";
import type { NewsItem } from "./types";

function news(overrides: Partial<NewsItem>): NewsItem {
  return {
    id: "x",
    title: "T",
    url: "https://example.com/a",
    publishedAt: "2026-09-20T10:00:00Z",
    publisher: "BK Häcken",
    category: "men",
    discoveredVia: "rss",
    ...overrides,
  };
}

describe("news events (one card per underlying story)", () => {
  it("merges multiple articles about the same event into one event with source pills", () => {
    const items = [
      news({ id: "1", title: "Häcken förlänger med Rygaard", publisher: "Sportbladet", url: "https://a.se/1", publishedAt: "2026-09-20T10:00:00Z" }),
      news({ id: "2", title: "Häcken förlänger med Rygaard", publisher: "Expressen", url: "https://b.se/2", publishedAt: "2026-09-20T12:00:00Z" }),
      news({ id: "3", title: "Häcken förlänger med Rygaard", publisher: "BK Häcken", url: "https://c.se/3", publishedAt: "2026-09-20T09:00:00Z" }),
    ];
    const events = buildNewsEvents(items);
    expect(events).toHaveLength(1);
    expect(events[0].sources).toHaveLength(3);
    expect(events[0].sources.map((s) => s.publisher)).toContain("BK Häcken");
  });

  it("keeps separate events for different stories", () => {
    const items = [
      news({ id: "1", title: "Häcken vinner matchen" }),
      news({ id: "2", title: "Ny sponsor för Häcken" }),
    ];
    expect(buildNewsEvents(items)).toHaveLength(2);
  });

  it("each source pill keeps its canonical URL", () => {
    const items = [
      news({ id: "1", title: "Samma händelse", url: "https://a.se/1" }),
      news({ id: "2", title: "Samma händelse", url: "https://b.se/2", publishedAt: "2026-09-20T12:00:00Z" }),
    ];
    const events = buildNewsEvents(items);
    const urls = events[0].sources.map((s) => s.url);
    expect(urls).toContain("https://a.se/1");
    expect(urls).toContain("https://b.se/2");
  });

  it("summary comes from source-derived description, never invented", () => {
    const items = [
      news({ id: "1", title: "Rubrik", summary: "Kort" }),
      news({ id: "2", title: "Rubrik", summary: "Häcken har förlängt avtalet med mittfältaren till och med säsongen 2028." }),
    ];
    const events = buildNewsEvents(items);
    expect(events[0].summary).toBe("Häcken har förlängt avtalet med mittfältaren med till och med säsongen 2028.".replace(" med till", " till"));
    expect(events[0].summaryMethod).toBe("rss-description");
  });

  it("falls back to title excerpt when no description exists", () => {
    const items = [news({ id: "1", title: "Bara en rubrik", summary: undefined })];
    const events = buildNewsEvents(items);
    expect(events[0].summary).toBe("Bara en rubrik".replace("Bara", "Bara"));
    expect(events[0].summaryMethod).toBe("excerpt");
  });

  it("publisher roles: BK Häcken primary, Sportbladet secondary", () => {
    expect(publisherRole("BK Häcken")).toBe("primary");
    expect(publisherRole("Sportbladet")).toBe("secondary");
    expect(publisherRole("Okänd Källa")).toBe("unknown");
  });

  it("source pills carry role and discovery info", () => {
    const items = [news({ id: "1", title: "Händelse", publisher: "Sportbladet", discoveredVia: "rss" })];
    const events = buildNewsEvents(items);
    expect(events[0].sources[0].role).toBe("secondary");
    expect(events[0].sources[0].discoveredVia).toBe("rss");
  });
});
