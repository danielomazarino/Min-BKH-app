import { describe, it, expect } from "vitest";
import { parseInfoboxFields, fetchInfobox } from "./infobox";

/**
 * REAL wikitext, captured live 2026-10-06 from the exact pages the user
 * named. Fixtures are verbatim (only trimmed) because the parser's whole
 * job is surviving real template nesting — a hand-written fixture would
 * quietly drop the cases that broke the naive-regex version.
 */

/** Bénie Traoré, sv.wikipedia — the "poor wikidata only" case. */
const TRAORE_SV = `{{Infobox fotbollsspelare
| spelarnamn              = Bénie Traoré
| bildfil                 = Bénie Traoré 2022.jpg
| bildtext                =
| fullständigtnamn        = Bénie Adama Traoré
| längd                   = 172 cm
| position                = Ytter
| nuvarandeklubb          = {{flaggbild|Schweiz|civil}} [[FC Basel|Basel]]
| juniorår                = 2019–2021
| juniorklubbar           = {{flaggbild|Elfenbenskusten}} [[ASEC Mimosas]]
| seniorår                = 2021–2023<br/>2023–2024<br/>2024<br/>2024–
| seniorklubbar           = {{flaggbild|Sverige}} [[BK Häcken]]<br/>{{flaggbild|England}} [[Sheffield United FC|Sheffield United]]<br/>→ {{flaggbild|Frankrike}} [[FC Nantes|Nantes]] (lån)<br/>{{flaggbild|Schweiz|civil}} [[FC Basel|Basel]]
| antalseniormatcher(mål) = 41 (15)<br/>8 {{0}}(0)<br/>14 {{0}}(0)<br/>60 (21)
| landslagsår             = 2023–2024<br/>2024–
| landslag                = {{hff|CIV|u=23}}<br/>{{hff|CIV}}
| antallandskamper(mål)   = 4 {{0}}(1)<br/>5 {{0}}(0)
}}
'''Bénie Adama Traoré''', född [[30 november]] [[2002]], är en [[Elfenbenskusten|ivoriansk]] [[fotboll]]sspelare.`;

/** What expandtemplates returns for those two hff calls, one per line. */
const TRAORE_HFF_EXPANDED = `<span class="flagicon">[[Fil:Flag of Côte d'Ivoire.svg|22x20px|kantlinje |alt=|länk=]]&nbsp;</span>[[Elfenbenskustens herrlandslag i fotboll|Elfenbenskusten&nbsp;U23]]
<span class="flagicon">[[Fil:Flag of Côte d'Ivoire.svg|22x20px|kantlinje |alt=|länk=]]&nbsp;</span>[[Elfenbenskustens herrlandslag i fotboll|Elfenbenskusten]]`;

/** Mats Hedén, en.wikipedia — the 1976 case with NO Wikidata career. */
const HEDEN_EN = `{{Short description|Swedish footballer}}
{{Use dmy dates|date=August 2024}}
{{Infobox football biography
|name           = Mats Hedén
|birth_date     = {{birth date and age|1976|5|20|df=y}}
|height         = 1.82m<ref name = "WF"/>
|position       = [[Defender (association football)|Defender]]
|years1         = 1998–2000
|clubs1         = [[Västra Frölunda IF|Västra Frölunda]]
|caps1          = 56
|goals1         = 0
|years2         = 2005–2006
|clubs2         = [[BK Häcken]]
|caps2          = 44
|goals2         = 0
|totalcaps      = 100
|totalgoals     = 0
}}
'''Mats Hedén''' (born 20 May 1976) is a Swedish former professional footballer.`;

/** Jeremy Agbonifo, sv.wikipedia — loans and foot preference. */
const AGBONIFO_SV = `{{Infobox fotbollsspelare
| spelarnamn              = Jeremy Agbonifo
| längd                   = 178 cm
| lateralitet             = Vänsterfotad
| position                = Ytter
| nuvarandeklubb          = {{flaggbild|Frankrike}} [[RC Lens|Lens]]
| seniorår                = 2024–2025<br />2025<br />2025–<br />2025–2026<br />2026
| seniorklubbar           = {{flaggbild|Sverige}} [[BK Häcken]]<br />→ {{flaggbild|Frankrike}} [[RC Lens|Lens]] (lån)<br />{{flaggbild|Frankrike}} [[RC Lens|Lens]]<br />→ {{flaggbild|Schweiz|civil}} [[FC Basel|Basel]] (lån)<br />→ {{flaggbild|Sverige}} [[BK Häcken]] (lån)
| antalseniormatcher(mål) = 13 {{0}}(2)<br />8 {{0}}(1)<br />0 {{0}}(0)<br />8 {{0}}(0)<br />8 {{0}}(1)
}}
'''Jeremy Nosakhare Agbonifo''', född 24 oktober 2005, är en svensk fotbollsspelare.`;

/** Martin Ericsson, sv.wikipedia — the "cut off at 2012" case. */
const ERICSSON_SV = `{{Infobox fotbollsspelare
| spelarnamn = Martin Ericsson
| längd = 177 cm
| position = Mittfältare
| proffsår = 1998–2000<br/>2001–2004<br/>2004–2006<br/>2006–2009<br/>2009–2012<br/>2012<br/>2012–2016
| proffsklubbar = {{flaggbild|Sverige}} [[IK Brage]]<br/>{{flaggbild|Sverige}} [[IFK Göteborg]]<br/>{{flaggbild|Danmark}} [[AaB Fodbold|Aalborg BK]]<br/>{{flaggbild|Danmark}} [[Brøndby IF]]<br/>{{flaggbild|Sverige}} [[IF Elfsborg]]<br/>→ {{flaggbild|Sverige}} [[BK Häcken]] (lån)<br />{{flaggbild|Sverige}} [[BK Häcken]]
| antalproffsmatcher(mål) = 72 {{0}}(8)<br/>69 (13)<br/>63 (16)<br/>83 (19)<br/>54 {{0}}(9)<br/>15 {{0}}(5)<br />109 (24)
}}
'''Martin Ericsson''', född [[4 september]] [[1980]], är en svensk före detta fotbollsspelare.`;

/** The identity trap: sv "Mats Hedén" is a MUSICIAN — no football infobox. */
const HEDEN_MUSICIAN_SV = `'''Mats Hedén''', född ''Mats Erik Nils Hedén'' [[18 december]] [[1960]], är en [[Sverige|svensk]] [[musiker]] ([[klaviatur]]).`;

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe("parseInfoboxFields — brace-depth-aware field splitting", () => {
  it("splits fields whose values contain nested templates", () => {
    const fields = parseInfoboxFields(TRAORE_SV);
    // The naive split-on-pipe version broke here: the pipe inside
    // {{flaggbild|Sverige}} is INSIDE the value, not a separator.
    expect(fields.get("seniorklubbar")).toContain("{{flaggbild|Sverige}} [[BK Häcken]]");
    expect(fields.get("nuvarandeklubb")).toContain("[[FC Basel|Basel]]");
  });

  it("reads the (mål) fields whose names contain parentheses", () => {
    const fields = parseInfoboxFields(TRAORE_SV);
    expect(fields.get("antalseniormatcher(mål)")).toContain("41 (15)");
  });

  it("returns an empty map when there is no infobox", () => {
    expect(parseInfoboxFields(HEDEN_MUSICIAN_SV).size).toBe(0);
  });
});

describe("fetchInfobox — the user's four examples", () => {
  it("Traoré: full career with years, apps, goals and the loan", async () => {
    // The parse request, then the batched hff expansion (only because this
    // page uses {{hff}} for its national rows).
    const calls: string[] = [];
    const fetchMock = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url.slice(0, 60));
      if (url.includes("expandtemplates")) {
        return jsonResponse({ expandtemplates: { wikitext: TRAORE_HFF_EXPANDED } });
      }
      return jsonResponse({ parse: { wikitext: { "*": TRAORE_SV } } });
    }) as unknown as typeof fetch;
    const data = await fetchInfobox("sv", "Bénie Traoré", { fetch: fetchMock });
    expect(data).not.toBeNull();
    expect(data?.heightCm).toBe(172);
    expect(data?.position).toBe("Ytter");
    expect(data?.currentClub).toBe("Basel");
    expect(data?.career).toHaveLength(4);
    expect(data?.career[0]).toMatchObject({ years: "2021–2023", team: "BK Häcken", apps: 41, goals: 15 });
    // The loan is marked and the flag template is gone.
    expect(data?.career[2]).toMatchObject({ team: "Nantes", loan: true });
    expect(data?.career[2]?.team).not.toContain("flaggbild");
    // The national rows resolved through the hff expansion.
    expect(data?.national).toHaveLength(2);
    expect(data?.national[0]?.team).toBe("Elfenbenskusten U23");
    expect(data?.national[1]?.team).toBe("Elfenbenskusten");
    expect(data?.national[0]?.apps).toBe(4);
    expect(data?.national[0]?.goals).toBe(1);
  });

  it("Hedén: height, position and career that Wikidata entirely lacks", async () => {
    const fetchMock = (async () => jsonResponse({ parse: { wikitext: { "*": HEDEN_EN } } })) as typeof fetch;
    const data = await fetchInfobox("en", "Mats Hedén", { fetch: fetchMock });
    expect(data).not.toBeNull();
    // "1.82m" — no space, with a ref suffix.
    expect(data?.heightCm).toBe(182);
    expect(data?.position).toBe("Defender");
    expect(data?.career).toHaveLength(2);
    expect(data?.career[0]).toMatchObject({ years: "1998–2000", team: "Västra Frölunda", apps: 56, goals: 0 });
    expect(data?.career[1]).toMatchObject({ years: "2005–2006", team: "BK Häcken", apps: 44 });
  });

  it("Agbonifo: foot preference and every loan", async () => {
    const fetchMock = (async () => jsonResponse({ parse: { wikitext: { "*": AGBONIFO_SV } } })) as typeof fetch;
    const data = await fetchInfobox("sv", "Jeremy Agbonifo", { fetch: fetchMock });
    expect(data).not.toBeNull();
    expect(data?.foot).toBe("Vänsterfotad");
    expect(data?.career).toHaveLength(5);
    const loans = data?.career.filter((s) => s.loan) ?? [];
    expect(loans).toHaveLength(3);
    expect(data?.career[1]?.team).toBe("Lens");
  });

  it("Ericsson: the 2012–2016 final stint Wikidata cut off", async () => {
    const fetchMock = (async () => jsonResponse({ parse: { wikitext: { "*": ERICSSON_SV } } })) as typeof fetch;
    const data = await fetchInfobox("sv", "Martin Ericsson (fotbollsspelare)", { fetch: fetchMock });
    expect(data).not.toBeNull();
    expect(data?.career).toHaveLength(7);
    // The stint the user reported as "cut off".
    expect(data?.career[6]).toMatchObject({ years: "2012–2016", team: "BK Häcken", apps: 109, goals: 24 });
  });

  it("returns null for a page without an infobox (the musician trap)", async () => {
    const fetchMock = (async () => jsonResponse({ parse: { wikitext: { "*": HEDEN_MUSICIAN_SV } } })) as typeof fetch;
    const data = await fetchInfobox("sv", "Mats Hedén", { fetch: fetchMock });
    expect(data).toBeNull();
  });

  it("returns null on a failed request instead of throwing", async () => {
    const fetchMock = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const data = await fetchInfobox("sv", "X", { fetch: fetchMock });
    expect(data).toBeNull();
  });
});

/**
 * The Norwegian/Danish infobox shape. REAL wikitext, captured live
 * 2026-10-07 from Brice Wembangomo's nowiki article — the user's own example
 * ("has stats on Norwegian Wikipedia"). It uses `Infoboks lagspiller` and
 * numbered `år`/`klubb`/`kamper`/`mål` fields, and writes every club as a
 * `{{Fk|...}}` template. Reading only the English field names returned an
 * EMPTY career for him.
 */
const WEMBANGOMO_NO = `{{Infoboks lagspiller
| nvklubb = {{Fk|Häcken}}
| draktnummer = 5
| ungdomsår1 ={{0}}{{0}}{{0}}{{0}}–2012| ungdomsklubb1 = [[Sarpsborg Fotballklubb|Sarpsborg]]
| ungdomsår2 =2013–2014| ungdomsklubb2 = {{Fk|Sarpsborg 08}}
| år1 =2014–2016| klubb1 ={{Fk|Sarpsborg 08}}| kamper1 = 1| mål1 = 0
| år2 =2015| klubb2 ={{Lån|{{Fk|Kvik Halden}}}}| kamper2 = 26| mål2 = 6
| år3 =2016| klubb3 ={{Lån|{{Fk|Fredrikstad}}}}| kamper3 = 9| mål3 = 0
| år4 =2017–2018| klubb4 ={{Fk|Jerv}}| kamper4 = 58| mål4 = 1
| år5 =2019–2021| klubb5 ={{Fk|Sandefjord}}| kamper5 = 59| mål5 = 0
| år6 =2022–2025| klubb6 ={{Fk|Bodø/Glimt}}| kamper6 = 67| mål6 = 3
| år7 =2025–| klubb7 ={{Fk|Häcken}}| kamper7 = 0| mål7 = 0
| landslagår1 =2023–| landslag1 ={{F|Norge}}| landslagkamper1 = 1| landslagmål1 = 0
}}
'''Brice Wembangomo''' (født 1996) er en norsk-kongolesisk fotballspiller.`;

describe("fetchInfobox — Norwegian/Danish infobox shape", () => {
  it("parses the numbered år/klubb/kamper/mål fields and the {{Fk}} club templates", async () => {
    const fetchMock = (async () => jsonResponse({ parse: { wikitext: { "*": WEMBANGOMO_NO } } })) as typeof fetch;
    const data = await fetchInfobox("no", "Brice Wembangomo", { fetch: fetchMock });
    expect(data).not.toBeNull();
    expect(data?.career).toHaveLength(7);
    expect(data?.career[0]).toMatchObject({ years: "2014–2016", team: "Sarpsborg 08", apps: 1, goals: 0 });
    // The loan arrow survives the {{Lån|...}} template.
    expect(data?.career[1]).toMatchObject({ years: "2015", team: "Kvik Halden", loan: true, apps: 26, goals: 6 });
    // The current club, from nvklubb.
    expect(data?.currentClub).toBe("Häcken");
    // The national team, from landslag1/{{F|Norge}}.
    expect(data?.national).toHaveLength(1);
    expect(data?.national[0]).toMatchObject({ years: "2023–", team: "Norge", apps: 1 });
  });
});