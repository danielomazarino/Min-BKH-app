import { describe, it, expect } from "vitest";
import { accumulateNews, RETENTION_DAYS, MAX_ACCUMULATED } from "./newsArchive";
import type { NewsItem } from "./types";

/**
 * The failure this prevents is SILENT and permanent: a feed sampled once a
 * night rolls over, and an article seen by no run is gone forever. Measured
 * 2026-10-08 — the 03:48 UTC run missed GP's "Rygaard om Häckens väntan"
 * published at 03:47:07.
 */

function item(over: Partial<NewsItem> & { url: string; title: string; publishedAt: string }): NewsItem {
  return {
    id: over.url,
    summary: undefined,
    publisher: "Göteborgs-Posten",
    category: "men",
    discoveredVia: "rss",
    dedupeKey: over.url,
    ...over,
  } as NewsItem;
}

const NOW = new Date("2026-10-08T04:00:00Z");

describe("accumulateNews", () => {
  it("keeps an article from a previous run that tonight's feed no longer carries", () => {
    // The exact reported case: GP's feed rolled over and lost the Rygaard piece.
    const previous = [item({ url: "https://gp.se/rygaard", title: "Rygaard om Häckens väntan", publishedAt: "2026-10-08T03:47:07Z" })];
    const fresh = [item({ url: "https://gp.se/other", title: "Något annat", publishedAt: "2026-10-08T03:50:00Z" })];
    const out = accumulateNews(previous, fresh, NOW);
    expect(out.map((n) => n.url)).toContain("https://gp.se/rygaard");
    expect(out.map((n) => n.url)).toContain("https://gp.se/other");
  });

  it("lets a fresh item win on URL collision (a corrected headline updates)", () => {
    const previous = [item({ url: "https://gp.se/a", title: "Gammal rubrik", publishedAt: "2026-10-07T10:00:00Z" })];
    const fresh = [item({ url: "https://gp.se/a", title: "Rättad rubrik", publishedAt: "2026-10-08T03:00:00Z" })];
    const out = accumulateNews(previous, fresh, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Rättad rubrik");
  });

  it("drops items older than the retention window", () => {
    const old = new Date(NOW.getTime() - (RETENTION_DAYS + 1) * 24 * 3600 * 1000).toISOString();
    const previous = [item({ url: "https://gp.se/old", title: "Gammal", publishedAt: old })];
    const out = accumulateNews(previous, [], NOW);
    expect(out).toHaveLength(0);
  });

  it("keeps items inside the retention window", () => {
    const recent = new Date(NOW.getTime() - (RETENTION_DAYS - 1) * 24 * 3600 * 1000).toISOString();
    const previous = [item({ url: "https://gp.se/recent", title: "Färsk", publishedAt: recent })];
    const out = accumulateNews(previous, [], NOW);
    expect(out).toHaveLength(1);
  });

  it("returns newest first", () => {
    const previous = [item({ url: "https://gp.se/1", title: "Äldre", publishedAt: "2026-10-06T10:00:00Z" })];
    const fresh = [item({ url: "https://gp.se/2", title: "Nyare", publishedAt: "2026-10-08T03:00:00Z" })];
    const out = accumulateNews(previous, fresh, NOW);
    expect(out[0].title).toBe("Nyare");
  });

  it("caps the list so app.json cannot grow without bound", () => {
    const many: NewsItem[] = [];
    for (let i = 0; i < MAX_ACCUMULATED + 20; i += 1) {
      many.push(item({ url: `https://gp.se/${i}`, title: `Artikel ${i}`, publishedAt: `2026-10-0${(i % 7) + 1}T10:00:00Z` }));
    }
    const out = accumulateNews(many, [], NOW);
    expect(out.length).toBeLessThanOrEqual(MAX_ACCUMULATED);
  });

  it("does not duplicate the same story seen on two nights", () => {
    const a = item({ url: "https://gp.se/x", title: "Samma story", publishedAt: "2026-10-07T10:00:00Z" });
    const out = accumulateNews([a], [a], NOW);
    expect(out).toHaveLength(1);
  });

  it("treats a URL with a query string as the same article", () => {
    const previous = [item({ url: "https://gp.se/a?utm_source=rss", title: "Artikel", publishedAt: "2026-10-07T10:00:00Z" })];
    const fresh = [item({ url: "https://gp.se/a", title: "Artikel", publishedAt: "2026-10-07T10:00:00Z" })];
    const out = accumulateNews(previous, fresh, NOW);
    expect(out).toHaveLength(1);
  });
});

/**
 * Re-validation of ARCHIVED items.
 *
 * THE DEFECT THIS PINS (measured 2026-10-09): accumulation never re-checked an
 * archived item, so an article kept by an earlier, looser build stayed on the
 * site for the full 21-day retention window after the rule that let it in was
 * fixed. Four false positives — "VM 94-hjälten Roger Ljung skiljer sig",
 * "Britt-Marie Mattsson: Trump bjuder in Putin…", plus two ice-hockey stories —
 * were re-published nightly, tagged "Tidigare spelare", even though the current
 * classifier returns UNRELATED for all four. A filter fix must be able to
 * WITHDRAW a wrong item, not only stop new ones.
 */
describe("accumulateNews — re-validation of archived items", () => {
  it("withdraws an archived item the current rules reject", () => {
    // Exactly the reported shape: stored category says "former", but a current
    // re-classification says it is not Häcken news at all.
    const stale = item({
      url: "https://expressen.se/roger-ljung",
      title: "VM 94-hjälten Roger Ljung skiljer sig",
      publishedAt: "2026-10-08T10:00:00Z",
      category: "former",
    });
    const isValid = (n: NewsItem) => !/Ljung|Mattsson|Timrå|Ovetjkin/.test(n.title);

    expect(accumulateNews([stale], [], NOW)).toHaveLength(1); // old behaviour: kept
    expect(accumulateNews([stale], [], NOW, { isStillValid: isValid })).toHaveLength(0);
  });

  it("keeps an archived item the current rules still accept", () => {
    const good = item({
      url: "https://ft.se/inoussa",
      title: "Officiellt: Zeidane Inoussa lånas ut av Swansea",
      publishedAt: "2026-10-08T10:00:00Z",
      category: "former",
    });
    const out = accumulateNews([good], [], NOW, { isStillValid: (n) => n.category === "former" });
    expect(out.map((n) => n.url)).toEqual(["https://ft.se/inoussa"]);
  });

  it("re-validates PREVIOUS only, never this run's fresh survivors", () => {
    // `fresh` already passed the current gates and is reflected in the run's own
    // audit — re-classifying it here could make the two disagree.
    const fresh = item({ url: "https://ft.se/fresh", title: "Färsk och godkänd", publishedAt: "2026-10-08T03:00:00Z" });
    const out = accumulateNews([], [fresh], NOW, { isStillValid: () => false });
    expect(out.map((n) => n.url)).toEqual(["https://ft.se/fresh"]);
  });

  it("still honours the retention window and cap when re-validating", () => {
    const old = new Date(NOW.getTime() - (RETENTION_DAYS + 1) * 24 * 3600 * 1000).toISOString();
    const previous = [
      item({ url: "https://gp.se/old", title: "Gammal", publishedAt: old }),
      item({ url: "https://gp.se/ok", title: "Godkänd", publishedAt: "2026-10-07T10:00:00Z" }),
    ];
    const out = accumulateNews(previous, [], NOW, { isStillValid: () => true });
    expect(out.map((n) => n.url)).toEqual(["https://gp.se/ok"]);
  });

  it("behaves exactly as before when no re-validator is supplied", () => {
    const previous = [
      item({ url: "https://gp.se/a", title: "A", publishedAt: "2026-10-07T10:00:00Z" }),
      item({ url: "https://gp.se/b", title: "B", publishedAt: "2026-10-06T10:00:00Z" }),
    ];
    expect(accumulateNews(previous, [], NOW).map((n) => n.url)).toEqual(
      accumulateNews(previous, [], NOW, {}).map((n) => n.url),
    );
  });
});
