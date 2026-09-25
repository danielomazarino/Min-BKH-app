import { describe, expect, it } from "vitest";
import { buildNewsEvents, publisherRole } from "./newsEvents";
import { searchPlayers, normalizeSearch } from "./search";
import type { NewsItem, FormerPlayer } from "./types";

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

function player(overrides: Partial<FormerPlayer>): FormerPlayer {
  return {
    id: "p1",
    name: "Mikkel Rygaard",
    currentClub: null,
    currentLeague: null,
    currentCountry: null,
    clubVerified: false,
    stats: null,
    contract: null,
    latestEvent: null,
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

describe("former player search", () => {
  const players = [
    player({ id: "1", name: "Mikkel Rygaard", aliases: ["rygaard"] }),
    player({ id: "2", name: "Samuel Gustafson", aliases: ["gustafson"] }),
    player({ id: "3", name: "Mattias Bjärsmy", aliases: ["bjärsmy", "bjarsmy"] }),
    player({ id: "4", name: "Jesper Karlström", aliases: ["karlström", "karlstrom"] }),
  ];

  it("finds by partial name", () => {
    expect(searchPlayers(players, "ryg")).toHaveLength(1);
    expect(searchPlayers(players, "Ryg")[0].name).toBe("Mikkel Rygaard");
  });

  it("is case-insensitive", () => {
    expect(searchPlayers(players, "MIKKEL")).toHaveLength(1);
  });

  it("handles Swedish characters: bjärsmy matches bjarsmy", () => {
    expect(searchPlayers(players, "bjarsmy")).toHaveLength(1);
    expect(searchPlayers(players, "Bjärsmy")).toHaveLength(1);
    expect(searchPlayers(players, "karlstrom")).toHaveLength(1);
    expect(searchPlayers(players, "Karlström")).toHaveLength(1);
  });

  it("matches aliases", () => {
    // "gustafson" matches Samuel Gustafson's name and Simon Gustafson's name.
    expect(searchPlayers(players, "gustafson").map((p) => p.id)).toEqual(["2"]);
    // Alias-only match: "rygaard" alias on player 1.
    expect(searchPlayers(players, "rygaard")).toHaveLength(1);
  });

  it("resolves alias to same canonical player: David Marek → David Frölund", () => {
    const frolund = player({
      id: "david-frolund",
      name: "David Frölund",
      aliases: ["marek", "david marek", "frolund"],
    });
    const roster = [...players, frolund];
    // Both names resolve to the same canonical player.
    expect(searchPlayers(roster, "Frölund").map((p) => p.id)).toEqual(["david-frolund"]);
    expect(searchPlayers(roster, "Marek").map((p) => p.id)).toEqual(["david-frolund"]);
    expect(searchPlayers(roster, "david marek").map((p) => p.id)).toEqual(["david-frolund"]);
    // Diacritic-insensitive: frolund matches Frölund.
    expect(searchPlayers(roster, "frolund")).toHaveLength(1);
  });

  it("unknown person produces no fabricated result", () => {
    expect(searchPlayers(players, "David Fredlund")).toHaveLength(0);
    expect(searchPlayers(players, "Zlatan Ibrahimovic")).toHaveLength(0);
  });

  it("empty query returns all players", () => {
    expect(searchPlayers(players, "")).toHaveLength(4);
    expect(searchPlayers(players, "   ")).toHaveLength(4);
  });

  it("returns empty for no match", () => {
    expect(searchPlayers(players, "zlatan")).toHaveLength(0);
  });

  it("normalizeSearch strips diacritics deterministically", () => {
    expect(normalizeSearch("Bjärsmy")).toBe(normalizeSearch("bjarsmy"));
    expect(normalizeSearch("Karlström")).toBe(normalizeSearch("karlstrom"));
  });
});
