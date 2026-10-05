import { describe, it, expect, vi } from "vitest";
import {
  buildSearchUrl,
  buildEntitiesUrl,
  isFootballer,
  isPerson,
  isNameEntity,
  toCandidate,
  searchPlayersOnline,
  commonsImageUrl,
  deriveNationalTeams,

  type SearchState,
} from "./wikidata";

/**
 * These tests exist because the failure modes in this module are SILENT.
 * A missing CORS parameter, a swallowed 429, or a mis-typed Wikidata property
 * all produce a plausible-looking empty result rather than an error. Each test
 * below pins one such failure to a visible assertion.
 *
 * Fixtures are real response shapes captured from the live API (2026-09-26).
 */

const FOOTBALLER_QID = "Q937857";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    headers: { get: (k: string) => init.headers?.[k] ?? null },
    json: async () => body,
  } as unknown as Response;
}

/** A real entity: Alexander Jeremejeff, Q16633101. */
const JEREMEJEFF = {
  id: "Q16633101",
  labels: { sv: { value: "Alexander Jeremejeff" }, en: { value: "Alexander Jeremejeff" } },
  descriptions: { sv: { value: "svensk fotbollsspelare" } },
  aliases: { sv: [{ value: "Jeremejeff" }] },
  claims: {
    P31: [{ mainsnak: { datavalue: { value: { id: "Q5" } } } }],
    P106: [{ mainsnak: { datavalue: { value: { id: FOOTBALLER_QID } } } }],
    P569: [{ mainsnak: { datavalue: { value: { time: "+1993-10-12T00:00:00Z", precision: 11 } } } }],
    P27: [{ mainsnak: { datavalue: { value: { id: "Q34" } } } }],
    P54: [
      { mainsnak: { datavalue: { value: { id: "Q639723" } } } },
      { mainsnak: { datavalue: { value: { id: "Q204881" } } } },
    ],
  },
};

/** "Andersson" the surname entity, Q2817217 — a real search contaminant. */
const ANDERSSON_SURNAME = {
  id: "Q2817217",
  labels: { sv: { value: "Andersson" } },
  claims: { P31: [{ mainsnak: { datavalue: { value: { id: "Q101352" } } } }] },
};

function indexResponse(hits: { id: string; label?: string; description?: string }[]) {
  return jsonResponse({ search: hits });
}

function entitiesResponse(entities: Record<string, unknown>) {
  return jsonResponse({ entities });
}

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
}

describe("URL construction", () => {
  /**
   * THE HIGHEST-RISK LINE IN THE MODULE.
   *
   * Measured 2026-09-26: with `origin=*` the response carries
   * `access-control-allow-origin: *`; without it, there is no CORS header at
   * all, so the request succeeds under curl and throws
   * "TypeError: Failed to fetch" in the browser. This assertion is the only
   * thing standing between a future refactor and that silent breakage.
   */
  it("always includes origin=* so the browser is allowed to read the response", () => {
    for (const url of [buildSearchUrl("test"), buildEntitiesUrl(["Q5"])]) {
      expect(url).toContain("origin=*");
    }
  });

  it("puts origin=* on EVERY wikidata request it builds", () => {
    expect(new URL(buildSearchUrl("x")).searchParams.get("origin")).toBe("*");
    expect(new URL(buildEntitiesUrl(["Q5"])).searchParams.get("origin")).toBe("*");
  });

  it("requests Swedish first, so the display label is the Swedish one", () => {
    const u = new URL(buildSearchUrl("Bjärsmyr"));
    expect(u.searchParams.get("language")).toBe("sv");
    expect(u.searchParams.get("uselang")).toBe("sv");
  });

  it("encodes the query rather than concatenating it raw", () => {
    // A name with a space and an ampersand must not alter the query string.
    const u = new URL(buildSearchUrl("David Marek & Co"));
    expect(u.searchParams.get("search")).toBe("David Marek & Co");
    expect(u.searchParams.get("action")).toBe("wbsearchentities");
  });

  it("joins Q-IDs with a pipe, which is what the API expects", () => {
    expect(new URL(buildEntitiesUrl(["Q1", "Q2"])).searchParams.get("ids")).toBe("Q1|Q2");
  });

  it("asks for the claims and aliases the hydration actually reads", () => {
    expect(new URL(buildEntitiesUrl(["Q1"])).searchParams.get("props")).toBe("labels|descriptions|claims|aliases");
  });
});

describe("entity classification", () => {
  it("recognises a person", () => {
    expect(isPerson(JEREMEJEFF as never)).toBe(true);
  });

  it("recognises a footballer", () => {
    expect(isFootballer(JEREMEJEFF as never)).toBe(true);
  });

  it("recognises a surname entity and keeps it out of player results", () => {
    expect(isNameEntity(ANDERSSON_SURNAME as never)).toBe(true);
    expect(isPerson(ANDERSSON_SURNAME as never)).toBe(false);
  });

  it("does not treat a person without an occupation claim as a footballer", () => {
    const personOnly = { id: "Q1", claims: { P31: [{ mainsnak: { datavalue: { value: { id: "Q5" } } } }] } };
    expect(isFootballer(personOnly as never)).toBe(false);
  });

  it("still counts a DEPRECATED occupation claim as evidence", () => {
    // Wikidata deprecates rather than deletes. A footballer whose only P106 is
    // deprecated is still a footballer, and dropping them silently would be
    // exactly the "no such player" lie this module exists to end.
    const deprecated = {
      id: "Q2",
      claims: { P106: [{ rank: "deprecated", mainsnak: { datavalue: { value: { id: FOOTBALLER_QID } } } }] },
    };
    expect(isFootballer(deprecated as never)).toBe(true);
  });
});

describe("commonsImageUrl", () => {
  // P18 stores a FILENAME, not a URL — verified live 2026-10-05 against
  // Q518833, whose P18 value is "Bjarsmyr at Panathinaikos.jpg".
  it("turns a P18 filename into a Commons FilePath URL", () => {
    expect(commonsImageUrl("Bjarsmyr at Panathinaikos.jpg")).toBe(
      "https://commons.wikimedia.org/wiki/Special:FilePath/Bjarsmyr%20at%20Panathinaikos.jpg?width=480",
    );
  });

  it("encodes characters that would break the URL", () => {
    // Real Commons filenames contain spaces and apostrophes. encodeURIComponent
    // leaves apostrophes as-is (they are legal in a URL path), which Commons
    // accepts; spaces must be encoded.
    const u = commonsImageUrl("O'Brien's goal.jpg");
    expect(u).toContain("O'Brien's%20goal.jpg");
  });

  it("honours a requested thumbnail width", () => {
    expect(commonsImageUrl("x.jpg", 120)).toContain("width=120");
  });
});

describe("deriveNationalTeams", () => {
  // Real P31 values, verified 2026-10-05: clubs carry Q476028, national teams
  // Q6979593 / Q135408445. IFK Göteborg ALSO carries Q103229495 (men's team)
  // — that value must never be treated as national.
  it("classifies by P31 class, not by name", () => {
    const index = {
      labels: new Map([
        ["Q201567", "IFK Göteborg"],
        ["Q2255267", "Sveriges U21-herrlandslag i fotboll"],
      ]),
      classes: new Map([
        ["Q201567", ["Q476028", "Q103229495"]],
        ["Q2255267", ["Q6979593"]],
      ]),
    };
    const national = deriveNationalTeams(index);
    expect(national.has("Q2255267")).toBe(true);
    expect(national.has("Q201567")).toBe(false);
  });

  it("falls back to the label when the class is missing", () => {
    // Some team entities have no P31 at all (measured: Q208265). "Landslag"
    // in the label is the Swedish word for national team.
    const index = {
      labels: new Map([["Q999", "Sveriges herrlandslag i fotboll"]]),
      classes: new Map(),
    };
    expect(deriveNationalTeams(index).has("Q999")).toBe(true);
  });

  it("never misfiles a club whose name merely contains 'national'", () => {
    const index = {
      labels: new Map([["Q888", "National Bank Egypt SC"]]),
      classes: new Map([["Q888", ["Q476028"]]]),
    };
    expect(deriveNationalTeams(index).has("Q888")).toBe(false);
  });
});

describe("toCandidate — career timeline", () => {
  /**
   * Real qualifier shapes captured from the live API 2026-10-05 (Q518833,
   * Q16633101). P580/P582 are years, P1350 apps, P1351 goals.
   */
  const BJARSMYR_CLUBS = [
    {
      mainsnak: { datavalue: { value: { id: "Q935299" } } },
      qualifiers: {
        P580: [{ datavalue: { value: { time: "+2002-01-01T00:00:00Z", precision: 9 } } }],
        P582: [{ datavalue: { value: { time: "+2004-01-01T00:00:00Z", precision: 9 } } }],
        P1350: [{ datavalue: { value: { amount: "+37" } } }],
        P1351: [{ datavalue: { value: { amount: "+0" } } }],
      },
    },
    {
      mainsnak: { datavalue: { value: { id: "Q201567" } } },
      qualifiers: {
        P580: [{ datavalue: { value: { time: "+2005-01-01T00:00:00Z", precision: 9 } } }],
        P582: [{ datavalue: { value: { time: "+2009-01-01T00:00:00Z", precision: 9 } } }],
        P1350: [{ datavalue: { value: { amount: "+104" } } }],
        P1351: [{ datavalue: { value: { amount: "+3" } } }],
      },
    },
    // An ongoing stint: end time absent. Must render as "????", never as
    // "still there" inferred from the gap.
    {
      mainsnak: { datavalue: { value: { id: "Q186785" } } },
      qualifiers: {
        P580: [{ datavalue: { value: { time: "+2012-01-01T00:00:00Z", precision: 9 } } }],
      },
    },
    // A national team — separated by the team's P31 class.
    {
      mainsnak: { datavalue: { value: { id: "Q2255267" } } },
      qualifiers: {
        P580: [{ datavalue: { value: { time: "+2005-01-01T00:00:00Z", precision: 9 } } }],
        P582: [{ datavalue: { value: { time: "+2009-01-01T00:00:00Z", precision: 9 } } }],
        P1350: [{ datavalue: { value: { amount: "+31" } } }],
      },
    },
  ];

  const LABELS = new Map([
    ["Q935299", "Husqvarna FF"],
    ["Q201567", "IFK Göteborg"],
    ["Q186785", "Rosenborg BK"],
    ["Q2255267", "Sveriges U21-herrlandslag i fotboll"],
  ]);
  const CLASSES = new Map([
    ["Q935299", ["Q476028"]],
    ["Q201567", ["Q476028"]],
    ["Q186785", ["Q476028"]],
    ["Q2255267", ["Q6979593"]],
  ]);

  function candidate() {
    const entity = {
      id: "Q518833",
      labels: { sv: { value: "Mattias Bjärsmyr" } },
      claims: { P54: BJARSMYR_CLUBS },
    };
    return toCandidate(entity as never, { query: "Bjärsmyr", labels: LABELS, classes: CLASSES });
  }

  it("builds a dated club timeline from P54 qualifiers", () => {
    const c = candidate();
    expect(c.career).toHaveLength(3);
    expect(c.career[0]).toMatchObject({ team: "Rosenborg BK", startYear: "2012", endYear: undefined });
    expect(c.career[1]).toMatchObject({ team: "IFK Göteborg", startYear: "2005", endYear: "2009", apps: 104, goals: 3 });
    expect(c.career[2]).toMatchObject({ team: "Husqvarna FF", startYear: "2002", endYear: "2004", apps: 37, goals: 0 });
  });

  it("sorts newest first, so the current club leads", () => {
    expect(candidate().career[0].team).toBe("Rosenborg BK");
  });

  it("keeps an open-ended stint open rather than inventing an end year", () => {
    const open = candidate().career.find((s) => s.team === "Rosenborg BK");
    expect(open?.endYear).toBeUndefined();
  });

  it("separates national teams from clubs by the team's own class", () => {
    const c = candidate();
    expect(c.nationalTeams).toHaveLength(1);
    expect(c.nationalTeams[0]).toMatchObject({ team: "Sveriges U21-herrlandslag i fotboll", caps: 31 });
    expect(c.career.some((s) => s.team.includes("landslag"))).toBe(false);
  });

  it("reads P413 as the position label", () => {
    const entity = {
      id: "Q1",
      labels: { sv: { value: "X" } },
      claims: { P413: [{ mainsnak: { datavalue: { value: { id: "Q280658" } } } }] },
    };
    const c = toCandidate(entity as never, {
      query: "x",
      labels: new Map([["Q280658", "anfallare"]]),
    });
    expect(c.position).toBe("anfallare");
  });

  it("falls back to the raw Q-ID when a position label never resolved", () => {
    const entity = {
      id: "Q1",
      labels: { sv: { value: "X" } },
      claims: { P413: [{ mainsnak: { datavalue: { value: { id: "Q280658" } } } }] },
    };
    const c = toCandidate(entity as never, { query: "x", labels: new Map() });
    expect(c.position).toBe("Q280658");
  });

  it("rejects an implausible apps/goals value rather than printing it", () => {
    const entity = {
      id: "Q1",
      labels: { sv: { value: "X" } },
      claims: {
        P54: [
          {
            mainsnak: { datavalue: { value: { id: "Q2" } } },
            qualifiers: {
              P1350: [{ datavalue: { value: { amount: "+99999" } } }],
              P1351: [{ datavalue: { value: { amount: "-5" } } }],
            },
          },
        ],
      },
    };
    const c = toCandidate(entity as never, { query: "x", labels: new Map([["Q2", "Klubb"]]) });
    expect(c.career[0].apps).toBeUndefined();
    expect(c.career[0].goals).toBeUndefined();
  });

  it("dedupes identical stints (Wikidata records several per stint)", () => {
    const entity = {
      id: "Q1",
      labels: { sv: { value: "X" } },
      claims: {
        P54: [BJARSMYR_CLUBS[0], BJARSMYR_CLUBS[0]],
      },
    };
    const c = toCandidate(entity as never, { query: "x", labels: LABELS, classes: CLASSES });
    expect(c.career).toHaveLength(1);
  });

  it("treats an unclassified team as a club, never as a national team", () => {
    // The conservative default: a misfiled club stint is a visible oddity,
    // a misfiled cap is a fabricated international career.
    const entity = {
      id: "Q1",
      labels: { sv: { value: "X" } },
      claims: { P54: [{ mainsnak: { datavalue: { value: { id: "Q777" } } } }] },
    };
    const c = toCandidate(entity as never, {
      query: "x",
      labels: new Map([["Q777", "Mystery Team"]]),
      classes: new Map(),
    });
    expect(c.career).toHaveLength(1);
    expect(c.nationalTeams).toHaveLength(0);
  });
});

describe("toCandidate", () => {
  const labels = new Map([
    ["Q34", "Sverige"],
    ["Q639723", "BK Häcken"],
    ["Q204881", "Malmö FF"],
  ]);

  it("uses the Q-ID as identity, never the name", () => {
    const c = toCandidate(JEREMEJEFF as never, { query: "Jeremejeff", labels });
    expect(c.qid).toBe("Q16633101");
  });

  it("detects the Häcken club claim and which team it is", () => {
    const c = toCandidate(JEREMEJEFF as never, { query: "Jeremejeff", labels });
    expect(c.hackenClub).toBe(true);
    expect(c.hackenTeam).toBe("men");
  });

  it("reports no Häcken connection when P54 does not include the club", () => {
    // Mattias Bjärsmyr (Q518833) has 10 P54 claims that do NOT include Q639723.
    const bjarsmyr = {
      id: "Q518833",
      labels: { sv: { value: "Mattias Bjärsmyr" } },
      claims: { P54: [{ mainsnak: { datavalue: { value: { id: "Q186785" } } } }] },
    };
    const c = toCandidate(bjarsmyr as never, { query: "Bjarsmyr", labels });
    expect(c.hackenClub).toBe(false);
    expect(c.hackenTeam).toBeNull();
  });

  it("parses a full-precision date of birth", () => {
    const c = toCandidate(JEREMEJEFF as never, { query: "x", labels });
    expect(c.dateOfBirth).toBe("1993-10-12");
  });

  it("keeps a reduced-precision year rather than inventing a date", () => {
    const yearOnly = {
      id: "Q3",
      labels: { sv: { value: "X" } },
      claims: { P569: [{ mainsnak: { datavalue: { value: { time: "+1980-00-00T00:00:00Z", precision: 6 } } } }] },
    };
    expect(toCandidate(yearOnly as never, { query: "x", labels }).dateOfBirth).toBe("1980");
  });

  it("ignores a nonsensical date rather than rendering garbage", () => {
    const absurd = {
      id: "Q4",
      labels: { sv: { value: "X" } },
      claims: { P569: [{ mainsnak: { datavalue: { value: { time: "+1200-01-01T00:00:00Z", precision: 11 } } } }] },
    };
    expect(toCandidate(absurd as never, { query: "x", labels }).dateOfBirth).toBeUndefined();
  });

  it("surfaces aliases but never duplicates the canonical name", () => {
    const c = toCandidate(JEREMEJEFF as never, { query: "x", labels });
    expect(c.alsoKnownAs).toContain("Jeremejeff");
    expect(c.alsoKnownAs).not.toContain("Alexander Jeremejeff");
  });

  it("labels unknown Q-IDs with the raw id rather than hiding them", () => {
    const c = toCandidate(JEREMEJEFF as never, { query: "x", labels: new Map() });
    expect(c.clubs).toContain("Q639723");
  });

  it("always produces a link back to the source", () => {
    const c = toCandidate(JEREMEJEFF as never, { query: "x", labels });
    expect(c.pageUrl).toBe("https://www.wikidata.org/wiki/Special:EntityPage/Q16633101");
  });

  /**
   * Regression guard for a bug ONLY a real browser found.
   *
   * P2048 stores the amount as `"+190"` with unit Q174728 (centimetre), i.e.
   * already in centimetres. The first implementation multiplied by 100 and
   * rendered "19000" as the height. No fixture had a P2048 claim, so the unit
   * suite passed while the live UI was wrong.
   */
  it("reads P2048 as centimetres without rescaling", () => {
    const withHeight = {
      id: "Q16633101",
      labels: { sv: { value: "Alexander Jeremejeff" } },
      claims: {
        P2048: [{ mainsnak: { datavalue: { value: { amount: "+190", unit: "http://www.wikidata.org/entity/Q174728" } } } }],
      },
    };
    expect(toCandidate(withHeight as never, { query: "x", labels }).heightCm).toBe(190);
  });

  it("rejects an implausible height rather than printing nonsense", () => {
    // If a value ever arrives in another unit, showing nothing beats showing a
    // wrong number in a sheet the user is about to trust.
    for (const amount of ["+1.9", "+1900", "+0"]) {
      const bad = {
        id: "Q1",
        labels: { sv: { value: "X" } },
        claims: { P2048: [{ mainsnak: { datavalue: { value: { amount } } } }] },
      };
      expect(toCandidate(bad as never, { query: "x", labels }).heightCm).toBeUndefined();
    }
  });

  it("leaves height undefined when the claim is absent", () => {
    const bare = { id: "Q2", labels: { sv: { value: "X" } }, claims: {} };
    expect(toCandidate(bare as never, { query: "x", labels }).heightCm).toBeUndefined();
  });

  /**
   * Regression guard for a second bug only a live check exposed.
   *
   * Q518833 (Bjärsmyr) has 10 P54 statements that resolve to the same handful
   * of clubs, so the sheet rendered "IFK Göteborg · ... · IFK Göteborg".
   * Wikidata records several statements per stint, and models one club as
   * more than one entity ("Örgryte IS" Q297906 vs "Örgryte IS Fotboll"
   * Q11903335), so dedupe must happen on the RESOLVED LABEL, not the Q-ID.
   */
  it("collapses duplicate clubs after labels are resolved", () => {
    const repeated = {
      id: "Q518833",
      labels: { sv: { value: "Mattias Bjärsmyr" } },
      claims: {
        P54: [
          { mainsnak: { datavalue: { value: { id: "Q201567" } } } },
          { mainsnak: { datavalue: { value: { id: "Q201567" } } } },
          { mainsnak: { datavalue: { value: { id: "Q186785" } } } },
        ],
      },
    };
    const withLabels = new Map([
      ["Q201567", "IFK Göteborg"],
      ["Q186785", "Rosenborg BK"],
    ]);
    const c = toCandidate(repeated as never, { query: "x", labels: withLabels });
    expect(c.clubs).toEqual(["IFK Göteborg", "Rosenborg BK"]);
  });

  it("collapses duplicate citizenship entries", () => {
    const twoCitizens = {
      id: "Q1",
      labels: { sv: { value: "X" } },
      claims: {
        P27: [
          { mainsnak: { datavalue: { value: { id: "Q34" } } } },
          { mainsnak: { datavalue: { value: { id: "Q34" } } } },
        ],
      },
    };
    const c = toCandidate(twoCitizens as never, { query: "x", labels: new Map([["Q34", "Sverige"]]) });
    expect(c.citizenship).toEqual(["Sverige"]);
  });

  it("still detects the Häcken link after deduplication", () => {
    // Dedupe must not drop the claim that decides the Häcken badge.
    const dup = {
      id: "Q16633101",
      labels: { sv: { value: "Alexander Jeremejeff" } },
      claims: {
        P54: [
          { mainsnak: { datavalue: { value: { id: "Q639723" } } } },
          { mainsnak: { datavalue: { value: { id: "Q639723" } } } },
        ],
      },
    };
    const c = toCandidate(dup as never, { query: "x", labels: new Map([["Q639723", "BK Häcken"]]) });
    expect(c.clubs).toEqual(["BK Häcken"]);
    expect(c.hackenTeam).toBe("men");
  });
});

describe("searchPlayersOnline — the six honest states", () => {
  it("returns results with hydrated data for a real match", async () => {
    const fetchMock = stubFetch((url) =>
      url.includes("wbsearchentities")
        ? indexResponse([{ id: "Q16633101", label: "Alexander Jeremejeff" }])
        : entitiesResponse({ Q16633101: JEREMEJEFF, Q34: { labels: { sv: { value: "Sverige" } } } }),
    );

    const state = (await searchPlayersOnline("Jeremejeff", { fetch: fetchMock })) as Extract<SearchState, { status: "results" }>;

    expect(state.status).toBe("results");
    expect(state.candidates[0].name).toBe("Alexander Jeremejeff");
    expect(state.candidates[0].hackenClub).toBe(true);
  });

  it("does not search on a query too short to be meaningful", async () => {
    const fetchMock = stubFetch(() => indexResponse([]));
    expect((await searchPlayersOnline("a", { fetch: fetchMock })).status).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * THE MOST IMPORTANT TEST IN THE FILE.
   *
   * A rate limit means "we did not look", not "no such player". Rendering it
   * as "not found" would reintroduce the exact dishonesty this module was
   * written to remove, only with a network error instead of a closed list.
   */
  it("reports a 429 as rate-limited, NEVER as not-found", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "42" } }));
    const state = await searchPlayersOnline("Jeremejeff", { fetch: fetchMock });
    expect(state.status).toBe("rate-limited");
    expect(state.status !== "not-found").toBe(true);
    if (state.status === "rate-limited") expect(state.retryAfterSeconds).toBe(42);
  });

  it("reports a 429 on the SECOND request too, not as an empty result", async () => {
    let call = 0;
    const fetchMock = stubFetch(() => {
      call += 1;
      return call === 1
        ? indexResponse([{ id: "Q16633101", label: "Alexander Jeremejeff" }])
        : jsonResponse({}, { status: 429 });
    });
    expect((await searchPlayersOnline("Jeremejeff", { fetch: fetchMock })).status).toBe("rate-limited");
  });

  it("reports a transport failure as failed, never as not-found", async () => {
    // TypeError is what a missing origin=* or an offline device produces.
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const state = await searchPlayersOnline("Jeremejeff", { fetch: fetchMock as never });
    expect(state.status).toBe("failed");
    if (state.status === "failed") expect(state.message).toMatch(/Kunde inte nå Wikidata/);
  });

  it("reports an HTTP error as failed and keeps the status code", async () => {
    const fetchMock = stubFetch(() => jsonResponse({ error: "boom" }, { status: 500 }));
    const state = await searchPlayersOnline("Jeremejeff", { fetch: fetchMock });
    expect(state.status).toBe("failed");
    if (state.status === "failed") expect(state.message).toContain("500");
  });

  it("reports an unparseable body as failed rather than as no results", async () => {
    const fetchMock = stubFetch(
      () =>
        ({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => {
            throw new SyntaxError("Unexpected token");
          },
        }) as unknown as Response,
    );
    expect((await searchPlayersOnline("Jeremejeff", { fetch: fetchMock })).status).toBe("failed");
  });

  it("returns not-found only when the index genuinely returned nothing", async () => {
    const fetchMock = stubFetch(() => indexResponse([]));
    const state = await searchPlayersOnline("Zzzz nonexistent", { fetch: fetchMock });
    expect(state.status).toBe("not-found");
    // Only one request: there was nothing to hydrate.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns not-found when every hit was filtered out as a non-person", async () => {
    // The index matched "Andersson" the surname. A person was not found, and
    // saying "not found" is correct here.
    const fetchMock = stubFetch((url) =>
      url.includes("wbsearchentities")
        ? indexResponse([{ id: "Q2817217", label: "Andersson" }])
        : entitiesResponse({ Q2817217: ANDERSSON_SURNAME }),
    );
    expect((await searchPlayersOnline("Andersson", { fetch: fetchMock })).status).toBe("not-found");
  });

  it("excludes surname entities from results even when they score an exact match", async () => {
    const fetchMock = stubFetch((url) =>
      url.includes("wbsearchentities")
        ? indexResponse([
            { id: "Q2817217", label: "Andersson" },
            { id: "Q352241", label: "Kennet Andersson" },
          ])
        : entitiesResponse({
            Q2817217: ANDERSSON_SURNAME,
            Q352241: { ...JEREMEJEFF, id: "Q352241", labels: { sv: { value: "Kennet Andersson" } } },
          }),
    );
    const state = (await searchPlayersOnline("Kennet Andersson", { fetch: fetchMock })) as Extract<
      SearchState,
      { status: "results" }
    >;
    expect(state.status).toBe("results");
    expect(state.candidates.map((c) => c.qid)).toEqual(["Q352241"]);
  });

  it("sends exactly two requests for a player with no resolvable labels", async () => {
    // A bare entity: one index call, one hydration call, and nothing to
    // translate. This is the floor, and it is what pins "no request per
    // keystroke" — the count cannot grow with the length of the query.
    const bare = { id: "Q16633101", labels: { sv: { value: "Alexander Jeremejeff" } }, claims: {} };
    const fetchMock = stubFetch((url) =>
      url.includes("wbsearchentities")
        ? indexResponse([{ id: "Q16633101", label: "Alexander Jeremejeff" }])
        : entitiesResponse({ Q16633101: bare }),
    );
    await searchPlayersOnline("Jeremejeff", { fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("adds exactly ONE extra call to resolve country and club labels, not one per player", async () => {
    // Wikidata's rate limit is ~10 requests/minute, so the total must not scale
    // with the number of candidates. Labels are batched into one call.
    const fetchMock = stubFetch((url) =>
      url.includes("wbsearchentities")
        ? indexResponse([{ id: "Q16633101", label: "Alexander Jeremejeff" }])
        : entitiesResponse({ Q16633101: JEREMEJEFF }),
    );
    await searchPlayersOnline("Jeremejeff", { fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("requests CORS on every call it makes", async () => {
    const fetchMock = stubFetch((url) =>
      url.includes("wbsearchentities")
        ? indexResponse([{ id: "Q16633101", label: "Alexander Jeremejeff" }])
        : entitiesResponse({ Q16633101: JEREMEJEFF }),
    );
    await searchPlayersOnline("Jeremejeff", { fetch: fetchMock });
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toContain("origin=*");
    }
  });

  it("still returns a usable player when label resolution fails", async () => {
    // A missing country/club name is decoration. Losing it must not fail the
    // whole search, or a rate limit on the third request would blank the app.
    let call = 0;
    const fetchMock = stubFetch((url) => {
      call += 1;
      if (url.includes("wbsearchentities")) return indexResponse([{ id: "Q16633101", label: "Alexander Jeremejeff" }]);
      if (call === 2) return entitiesResponse({ Q16633101: JEREMEJEFF });
      return jsonResponse({}, { status: 429 });
    });
    const state = (await searchPlayersOnline("Jeremejeff", { fetch: fetchMock })) as Extract<
      SearchState,
      { status: "results" }
    >;
    expect(state.status).toBe("results");
    expect(state.candidates[0].name).toBe("Alexander Jeremejeff");
  });
});
