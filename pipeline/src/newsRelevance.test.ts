import { describe, expect, it } from "vitest";
import { classifyRelevance, mentionsHäcken, slugText, type KnownPersons } from "./newsRelevance";

const KNOWN: KnownPersons = {
  currentPlayers: ["Sondr", "Silas", "Layouni"],
  formerPlayers: ["Alexander Jeremejeff", "Mikkel Rygaard", "Bjärsmy"],
};

function cls(title: string, summary = "", publisher = "Göteborgs-Posten") {
  return classifyRelevance({ title, summary, publisher }, KNOWN);
}

describe("classifyRelevance — regression against known false positives", () => {
  it("Isak/Liverpool is UNRELATED (no Häcken relation)", () => {
    const r = cls("Isak gjorde mål för Liverpool i Premier League", "Alexander Isak scorede igen för Liverpool.");
    expect(r.relevance).toBe("UNRELATED");
  });

  it("Tottenham/Levy story is UNRELATED", () => {
    const r = cls("Levy lämnar Tottenham efter 24 år", "Daniel Levy avgår som ordförande i Tottenham.");
    expect(r.relevance).toBe("UNRELATED");
  });

  it("MLS/Columbus story is UNRELATED", () => {
    const r = cls("Columbus Crew vann i MLS", "Stor seger för Columbus i Major League Soccer.");
    expect(r.relevance).toBe("UNRELATED");
  });

  it("Birmingham story is UNRELATED", () => {
    const r = cls("Birmingham nytt rekord i Championship", "Birmingham City fortsätter vinna.");
    expect(r.relevance).toBe("UNRELATED");
  });

  it("generic 'klubb' wording is never sufficient evidence", () => {
    const r = cls("Klubben bekräftar ny tränare", "Klubben presenterar ny huvudtränare inför nästa säsong.");
    expect(r.relevance).toBe("UNRELATED");
    expect(r.reason).toBe("no Häcken relationship established");
  });

  it("generic 'förening' wording is never sufficient evidence", () => {
    const r = cls("Föreningen presenterar ny sponsor", "Föreningen har tecknat avtal.");
    expect(r.relevance).toBe("UNRELATED");
  });

  it("transfer-openness story without Häcken mention is UNRELATED", () => {
    const r = cls("Spelare öppen för transfer", "Mittfältaren är öppen för ett klubbbyte i vinter.");
    expect(r.relevance).toBe("UNRELATED");
  });

  it("Bergvalls (no Häcken context) is UNRELATED", () => {
    const r = cls("Bergvall imponerar i Premier League", "Lucas Bergvall hyllas i Tottenham.");
    expect(r.relevance).toBe("UNRELATED");
  });

  it("Viktor Andersson (no Häcken context) is UNRELATED", () => {
    const r = cls("Viktor Andersson räddade poängen", "Målvakten Viktor Andersson var stor i mål för danska klubben.");
    expect(r.relevance).toBe("UNRELATED");
  });
});

describe("classifyRelevance — multi-part surnames (measured 2026-10-08)", () => {
  // The squad lists "Mikkel Rygaard Jensen" but the press uses "Mikkel
  // Rygaard". Taking the LAST token as the surname yielded "Jensen", so every
  // "Rygaard …" headline was dropped as "no Häcken relation".
  const KNOWN_MULTI: KnownPersons = {
    currentPlayers: ["Mikkel Rygaard Jensen", "Sabri Dahari Kondo", "Bamir Fierza Sadiku", "Christ Ivan Wawa"],
  };
  const clsm = (title: string, summary = "", publisher = "Fotbolltransfers") =>
    classifyRelevance({ title, summary, publisher }, KNOWN_MULTI);

  it("matches the middle surname 'Rygaard' (not the last token 'Jensen')", () => {
    const r = clsm("Rygaard: \"Primära intresset ligger i att komma hem till Danmark\"");
    expect(r.relevance).toBe("CURRENT_HACKEN");
    expect(r.matchedPerson).toBe("Mikkel Rygaard Jensen");
  });

  it("matches the possessive form 'Rygaards'", () => {
    const r = clsm("Rygaards gläds över transfern: \"Alla tänkte wow\"");
    expect(r.relevance).toBe("CURRENT_HACKEN");
  });

  it("matches 'Kondo' for Sabri Dahari Kondo", () => {
    const r = clsm("Kondo om framtiden i Häcken", "Mittfältaren öppnar för samtal.");
    expect(r.relevance).toBe("CURRENT_HACKEN");
  });

  it("matches 'Sadiku' for Bamir Fierza Sadiku", () => {
    const r = clsm("Sadiku tillbaka i träning", "Anfallaren är redo igen.");
    expect(r.relevance).toBe("CURRENT_HACKEN");
  });

  it("does NOT match a bare middle given-name 'Ivan' (Christ Ivan Wawa)", () => {
    // A middle token that is a given name must not make every Ivan article a
    // Häcken article. "ivan" is 4 chars, below the 5-char middle-token floor.
    const r = clsm("Ivan gjorde mål för sitt nya lag", "Ivan hyllades efter matchen.");
    expect(r.relevance).toBe("UNRELATED");
  });

  it("does NOT match the ambiguous last token 'Jensen'", () => {
    const r = clsm("Jensen räddade poängen för sitt lag", "Målvakten Jensen var stor.");
    expect(r.relevance).toBe("UNRELATED");
  });
});

describe("classifyRelevance — genuine Häcken articles retained", () => {
  it("official BK Häcken publisher is CURRENT_HACKEN", () => {
    const r = cls("Häcken vinner hemma", "2-0 mot Djurgården.", "BK Häcken");
    expect(r.relevance).toBe("CURRENT_HACKEN");
  });

  it("Häcken mention with men's competition marker is CURRENT_HACKEN", () => {
    const r = cls("Häcken tog tre poäng i Allsvenskan", "Segern lyfte laget i tabellen.");
    expect(r.relevance).toBe("CURRENT_HACKEN");
  });

  it("Häcken mention without men's evidence is UNKNOWN (could be women's)", () => {
    const r = cls("Häcken tog tre poäng borta", "Segern i Göteborg lyfte laget i tabellen.");
    expect(r.relevance).toBe("UNKNOWN");
  });

  it("Häcken + known current player is CURRENT_HACKEN", () => {
    const r = cls("Häcken nyckelspelare tillbaka", "Sondr är tillbaka i träningsformen.");
    expect(r.relevance).toBe("CURRENT_HACKEN");
    expect(r.matchedPerson).toBeTruthy();
  });

  it("known current player without club mention is CURRENT_HACKEN", () => {
    const r = cls("Silas gjorde två mål", "Stor kväll för Silas i Allsvenskan.");
    expect(r.relevance).toBe("CURRENT_HACKEN");
  });

  it("known former player without club mention is FORMER_PLAYER", () => {
    const r = cls("Jeremejeff nytt klubbbyte", "Alexander Jeremejeff skriver för ny klubb.");
    expect(r.relevance).toBe("FORMER_PLAYER");
  });

  it("Allsvenskan without Häcken is GENERAL_ALLSVENSKAN", () => {
    const r = cls("Malmö vann toppmötet i Allsvenskan", "Stormatch på Tele2 mellan Malmö och AIK.");
    expect(r.relevance).toBe("GENERAL_ALLSVENSKAN");
  });

  it("women's context on official source is UNRELATED", () => {
    const r = cls("Häcken damerna spelade oavgjort", "Damerna tog en poäng.", "BK Häcken");
    expect(r.relevance).toBe("UNRELATED");
  });

  it("youth context on official source is UNRELATED", () => {
    const r = cls("Häcken akademi vann derby", "Pojkarna U17 visade stark form.", "BK Häcken");
    expect(r.relevance).toBe("UNRELATED");
  });
});
describe("classifyRelevance — women's-team exclusion (regression: Sportbladet 2026-09)", () => {
  const KNOWN_W = {
    currentPlayers: ["Gustav Lindgren", "Abdoulaye Doumbia"],
    formerPlayers: [],
    womenPlayers: ["Jennifer Falk", "Elin Rubensson", "Laney Egbuka"],
    womenContextTerms: ["damallsvenskan", "champions league dam"],
  };
  const clsw = (title: string, summary = "", publisher = "Sportbladet") =>
    classifyRelevance({ title, summary, publisher }, KNOWN_W);

  it("supplied women's article (målvakter mot Juventus) is NOT men's", () => {
    // Real RSS title+summary as the app receives it. No men's evidence → UNKNOWN, excluded from men's feed.
    const r = clsw("Häckens målvakter mot Juventus – två tonåringar", "”Lite speciellt” ✓ Så blir det nu");
    expect(r.relevance).toBe("UNKNOWN");
  });

  it("women's article with known women's player (Falk utvisad) is UNRELATED", () => {
    const r = clsw("Förlust och Falk utvisad i Häckens CL-premiär", "16-åring tvingades in i målvaktsrollen");
    expect(r.relevance).toBe("UNRELATED");
    expect(r.reason).toContain("women's context");
  });

  it("surname-only women's player match works (Falk)", () => {
    const r = clsw("Falk räddade poängen för Häcken", "");
    expect(r.relevance).toBe("UNRELATED");
  });

  it("Damallsvenskan term marks women's context", () => {
    const r = clsw("Häcken vinner i Damallsvenskan", "Storseger borta.");
    expect(r.relevance).toBe("UNRELATED");
  });

  it("genuine men's article with known men's player is accepted", () => {
    const r = clsw("Häcken tog tre poäng i Allsvenskan", "Gustav Lindgren gjorde matchens mål.");
    expect(r.relevance).toBe("CURRENT_HACKEN");
  });

  it("men's competition marker without player is accepted", () => {
    const r = clsw("Häcken vann i Svenska Cupen herr", "1-0 efter mål i andra halvlek.");
    expect(r.relevance).toBe("CURRENT_HACKEN");
  });

  it("generic Häcken article without men's evidence is not silently men's", () => {
    const r = clsw("Häcken spelar nästa vecka", "");
    expect(r.relevance).toBe("UNKNOWN");
  });
});

/**
 * URL-slug and article-body evidence (measured 2026-10-09).
 *
 * The Fotbolltransfers club feed puts the SUBJECT in the slug and often states
 * the Häcken relationship only in the BODY. Measured on the live feed:
 * title+summary matched 7 of 20 items, +slug matched 11, +body matched 20/20
 * with no false positives. These tests pin the mechanism, not the feed.
 */
describe("classifyRelevance — URL slug evidence", () => {
  const KNOWN_SLUG: KnownPersons = {
    currentPlayers: ["Mikkel Rygaard Jensen", "Nikola Mitrovic"],
    formerPlayers: [],
  };
  const clss = (title: string, slug: string, summary = "", publisher = "Fotbolltransfers") =>
    classifyRelevance({ title, summary, publisher, url: `https://fotbolltransfers.com/nyheter/${slug}/222568` }, KNOWN_SLUG);

  it("matches the subject named only in the slug", () => {
    // Real pair: the title names nobody, the slug names squad player Rygaard.
    const r = clss("Öppnar för flytt inom Allsvenskan", "mikkel-rygaard-oppnar-for-flytt-inom-allsvenskan");
    expect(r.relevance).toBe("CURRENT_HACKEN");
    expect(r.matchedPerson).toBe("Mikkel Rygaard Jensen");
  });

  it("normalises the ASCII-fied slug (å/ä→a, ö→o, hyphens→spaces)", () => {
    // The slug is lowercase ASCII, the squad name is not — they must still meet.
    const r = clss("Officiellt: Lämnar Häcken för division 2-klubb", "officiellt-vastra-frolunda-lanar-nikola-mitrovic");
    expect(r.relevance).toBe("CURRENT_HACKEN");
    expect(r.matchedPerson).toBe("Nikola Mitrovic");
  });

  it("drops the trailing numeric article id from the slug", () => {
    expect(slugText("https://fotbolltransfers.com/nyheter/foo-bar/222568")).toBe("foo bar");
    expect(slugText("https://x.com/nyheter/foo-bar/")).toBe("foo bar");
    expect(slugText("https://x.com/a/b/foo-bar?utm=1")).toBe("foo bar");
    expect(slugText("")).toBe("");
  });

  it("a slug-only surname match does NOT fire for ambiguous surnames", () => {
    // "andersson" is ambiguous — a slug mentioning an Andersson must not make
    // the article a Häcken article just because a squad player shares it.
    const known: KnownPersons = { currentPlayers: ["David Andersson"], formerPlayers: [] };
    const r = classifyRelevance(
      { title: "Bokar upp landslagskollen", summary: "", publisher: "Sportbladet", url: "https://x.com/viktor-andersson-bokar/1" },
      known,
    );
    expect(r.relevance).toBe("UNRELATED");
  });
});

describe("classifyRelevance — article body evidence", () => {
  const KNOWN_BODY: KnownPersons = { currentPlayers: ["Nikola Mitrovic"], formerPlayers: [] };

  it("body Häcken mention + a men's competition marker is accepted", () => {
    // Deliberately NOT clubScoped: this models a general feed whose body names
    // Häcken. The Häcken mention plus the men's marker "Allsvenskan" is enough.
    const r = classifyRelevance(
      {
        title: "Officiellt: Severin Nioule byter klubb",
        summary: "Severin Nioule lämnar Royal Charleroi SC.",
        publisher: "Fotbollstransfers",
        bodyText: "BK Häcken värvade Severin Nioule från ASEC Mimosas 2023. Han gjorde två mål i Allsvenskan.",
      },
      KNOWN_BODY,
    );
    expect(r.relevance).toBe("CURRENT_HACKEN");
  });

  it("a body Häcken mention WITHOUT a men's marker stays UNKNOWN on a general feed", () => {
    // Correct conservative behaviour, and the reason the prefilter keeping such
    // an item is not sufficient on its own: the prefilter establishes that
    // Häcken is mentioned, the men's gate establishes that it is the MEN'S
    // team. "den allsvenska klubben" is the adjective, not the league name, so
    // this is still UNKNOWN here — and the club-scoped flag is what resolves it
    // for the Fotbolltransfers club feed.
    const bodyText = "Den allsvenska klubben BK Häcken värvade Severin Nioule, 21, från ASEC Mimosas sommaren 2023.";
    const r = classifyRelevance(
      { title: "Officiellt: Severin Nioule byter klubb", summary: "", publisher: "Sportbladet", bodyText },
      KNOWN_BODY,
    );
    expect(r.relevance).toBe("UNKNOWN");
    // …and the SAME article is accepted once the source scope is known.
    const scoped = classifyRelevance(
      { title: "Officiellt: Severin Nioule byter klubb", summary: "", publisher: "Fotbollstransfers", bodyText, clubScoped: true },
      KNOWN_BODY,
    );
    expect(scoped.relevance).toBe("CURRENT_HACKEN");
  });

  it("finds a named player in the body when the title/summary omit them", () => {
    const r = classifyRelevance(
      {
        title: "Nyförvärvet om sin första tid",
        summary: "Mittfältaren berättar om säsongsinledningen.",
        publisher: "Fotbolltransfers",
        bodyText: "Nikola Mitrovic har gjort fem matcher sedan han kom till klubben.",
      },
      KNOWN_BODY,
    );
    expect(r.relevance).toBe("CURRENT_HACKEN");
    expect(r.matchedPerson).toBe("Nikola Mitrovic");
  });

  it("the Häcken mention is found in the body when title and summary lack it", () => {
    // Silas Andersen left Häcken but is NOT in Wikidata P54, so no known-person
    // match is possible. The only Häcken evidence is the body sentence.
    const title = "Silas Andersen: \"Jag skulle älska det\"";
    const summary = "Silas Andersen hoppas få chansen att spela med Cristiano Ronaldo i Sporting CP.";
    const bodyText = "Silas Andersen lämnade BK Häcken för Sporting CP i somras.";
    expect(mentionsHäcken(title, summary)).toBe(false);
    expect(mentionsHäcken(title, summary, { bodyText })).toBe(true);
  });

  it("body cannot resurrect a women's article", () => {
    const r = classifyRelevance(
      {
        title: "Häcken spelar viktig match",
        summary: "",
        publisher: "Sportbladet",
        bodyText: "Damlaget möter Vittsjö i Damallsvenskan.",
      },
      { currentPlayers: [], formerPlayers: [] },
    );
    expect(r.relevance).toBe("UNRELATED");
    expect(r.category).toBe("women");
  });
});

/**
 * Club-scoped feeds (measured 2026-10-09).
 *
 * Fotbolltransfers' `/rss/klubbar/27` is BK Häcken's own club feed. Its scope
 * is source-level men's Häcken evidence — the analogue of the official
 * bkhacken.se feed — so a Häcken mention does not additionally need a
 * competition keyword. Verified: all 20 live items mention Häcken in the body,
 * none mention "dam", and Fotbolltransfers lists no women's league.
 *
 * The flag replaces ONLY the `menMarker` requirement. It never removes the
 * Häcken-mention requirement, and it never overrides the women's veto.
 */
describe("classifyRelevance — club-scoped feed", () => {
  const k: KnownPersons = { currentPlayers: [], formerPlayers: [] };
  const cl = (title: string, summary = "", clubScoped = true) =>
    classifyRelevance({ title, summary, publisher: "Fotbolltransfers", clubScoped }, k);

  it("club finance story with a Häcken mention is accepted", () => {
    const r = cl("\"Krävs för att BK Häcken ska fortsätta vara konkurrenskraftiga\"", "BK Häcken noterar minskade intäkter och varslar nu personal.");
    expect(r.relevance).toBe("CURRENT_HACKEN");
    expect(r.reason).toBe("club-scoped feed + Häcken mention");
  });

  it("same item from a general secondary source stays UNKNOWN (flag is what changed)", () => {
    const r = classifyRelevance(
      { title: "\"Krävs för att BK Häcken ska fortsätta vara konkurrenskraftiga\"", summary: "BK Häcken noterar minskade intäkter och varslar nu personal.", publisher: "Sportbladet" },
      k,
    );
    expect(r.relevance).toBe("UNKNOWN");
  });

  it("still requires a Häcken mention — scope alone is not enough", () => {
    const r = cl("Allsvenskan: Örgryte och Mjällby spelar inför omstart");
    expect(r.relevance).toBe("GENERAL_ALLSVENSKAN");
  });

  it("does NOT override the women's veto", () => {
    const r = cl("Häcken damerna spelade oavgjort", "Damerna tog en poäng mot Vittsjö.");
    expect(r.relevance).toBe("UNRELATED");
    expect(r.category).toBe("women");
  });

  it("does NOT override the youth veto", () => {
    const r = cl("Häcken akademi vann derby", "Pojkarna U17 visade stark form.");
    expect(r.relevance).toBe("UNRELATED");
    expect(r.category).toBe("youth");
  });
});
