import { describe, it, expect, vi } from "vitest";
import { enrichSquadPlayer, enrichSquad } from "./squadEnrichment";
import type { SeasonPlayerStat } from "./types";

/**
 * The enrichment runs in the pipeline, so its failure modes are silent: a
 * player that fails to resolve is simply absent, and the app falls back to a
 * live search. These tests pin that a failure is per-player and never fatal,
 * and that the merged career is the UNION (the bug the user reported).
 */

const FOOTBALLER_QID = "Q937857";

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

const BERISHA = {
  id: "Q1523030",
  labels: { sv: { value: "Etrit Berisha" } },
  descriptions: { sv: { value: "albansk fotbollsspelare" } },
  claims: {
    P31: [{ mainsnak: { datavalue: { value: { id: "Q5" } } } }],
    P106: [{ mainsnak: { datavalue: { value: { id: FOOTBALLER_QID } } } }],
    P54: [
      { mainsnak: { datavalue: { value: { id: "Q639723" } } } }, // BK Häcken, no years
      { mainsnak: { datavalue: { value: { id: "Q204881" } } } }, // Empoli
    ],
  },
  sitelinks: { svwiki: { title: "Etrit Berisha" } },
};

const BERISHA_SV = `{{Infobox fotbollsspelare
| längd = 187 cm
| position = Målvakt
| seniorår = 2023–2024<br/>2025–
| seniorklubbar = [[Empoli FC|Empoli]]<br/>[[BK Häcken|Häcken]]
| antalseniormatcher(mål) = 30 (0)<br/>5 (0)
}}`;

const player = (name: string, id = "fogis:1"): SeasonPlayerStat => ({
  playerId: id,
  playerName: name,
  positionGroup: "goalkeepers",
  matchesPlayed: 5,
  matchesStarted: 5,
  goals: 0,
  assists: 0,
  yellowCards: 0,
  redCards: 0,
  competition: "Allsvenskan",
});

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL) => handler(String(input)));
}

describe("enrichSquadPlayer", () => {
  it("resolves a player and merges the infobox career with Wikidata's", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes("wbsearchentities")) return jsonResponse({ search: [{ id: "Q1523030" }] });
      if (url.includes("wbgetentities")) return jsonResponse({ entities: { Q1523030: BERISHA } });
      if (url.includes("action=parse")) return jsonResponse({ parse: { wikitext: { "*": BERISHA_SV } } });
      if (url.includes("rest_v1/page/summary")) {
        return jsonResponse({ extract: "Etrit Berisha är en albansk målvakt.", wikibase_item: "Q1523030" });
      }
      return jsonResponse({});
    });
    const e = await enrichSquadPlayer(player("Etrit Berisha"), { fetch: fetchMock as unknown as typeof fetch });
    expect(e).not.toBeNull();
    expect(e?.qid).toBe("Q1523030");
    // The union: Häcken (from the infobox, dated) AND Empoli.
    const teams = e?.career.map((s) => s.team) ?? [];
    expect(teams.some((t) => t.includes("Häcken"))).toBe(true);
    expect(teams.some((t) => t.includes("Empoli"))).toBe(true);
    // The Häcken row carries the infobox's years, not "????–????".
    const hacken = e?.career.find((s) => s.team.includes("Häcken"));
    expect(hacken?.years).toBe("2025–");
    expect(e?.usedInfobox).toBe(true);
    expect(e?.wiki?.extract).toContain("albansk");
  });

  it("returns null when Wikidata has no match — the honest answer, not an error", async () => {
    const fetchMock = stubFetch((url) =>
      url.includes("wbsearchentities") ? jsonResponse({ search: [] }) : jsonResponse({ query: { search: [] } }),
    );
    const e = await enrichSquadPlayer(player("Nobody At All"), { fetch: fetchMock as unknown as typeof fetch });
    expect(e).toBeNull();
  });
});

describe("enrichSquad", () => {
  it("tolerates a per-player failure and keeps the rest", async () => {
    const fetchMock = stubFetch((url) => {
      if (url.includes("wbsearchentities")) {
        // Only the first player resolves.
        return jsonResponse({ search: url.includes("Berisha") ? [{ id: "Q1523030" }] : [] });
      }
      if (url.includes("wbgetentities")) return jsonResponse({ entities: { Q1523030: BERISHA } });
      if (url.includes("action=parse")) return jsonResponse({ parse: { wikitext: { "*": BERISHA_SV } } });
      if (url.includes("rest_v1/page/summary")) return jsonResponse({ extract: "x", wikibase_item: "Q1523030" });
      return jsonResponse({ query: { search: [] } });
    });
    const squad = [player("Etrit Berisha", "fogis:1"), player("Nobody At All", "fogis:2")];
    const out = await enrichSquad(squad, { fetch: fetchMock as unknown as typeof fetch, delayMs: 0 });
    expect(Object.keys(out)).toEqual(["fogis:1"]);
    expect(out["fogis:1"].qid).toBe("Q1523030");
  });

  it("never throws when the transport fails for every player", async () => {
    const fetchMock = stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const out = await enrichSquad([player("A"), player("B")], {
      fetch: fetchMock as unknown as typeof fetch,
      delayMs: 0,
    });
    expect(out).toEqual({});
  });
});
