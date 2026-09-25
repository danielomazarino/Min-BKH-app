import { describe, expect, it } from "vitest";
import { classifyRelevance, type KnownPersons } from "./newsRelevance";

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
