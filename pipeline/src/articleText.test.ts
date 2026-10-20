/**
 * Per-source article extraction, `og:image` capture and the readable-source
 * allow-list.
 *
 * WHY THIS EXISTS (measured 2026-10-09): the detail sheet offered only a
 * summary plus links, so reading a story meant leaving the app. Two things were
 * missing:
 *
 *  1. `og:image` was never read, so only bkhacken.se's RSS `<enclosure>` gave a
 *     thumbnail — 4 of 21 events had an image.
 *  2. The generic tag-strip returned the page's navigation as "body text". On
 *     fotbolltransfers that meant a body starting "Logga in Kontakt Annonsera
 *     Nyheter Övergångar Podd Ligor …".
 *
 * The allow-list is a LEGAL boundary, not a technical one: bkhacken.se and
 * fotbolltransfers.com both publish `User-agent: *` / `Disallow:` (empty =
 * everything allowed) and neither is paywalled. Expressen is excluded on two
 * independent grounds — it is paywalled AND Bonnier News' robots.txt prohibits
 * scraping "for text and data aggregation".
 */
import { describe, expect, it } from "vitest";
import {
  decodeEntities,
  extractArticleBody,
  extractBkhBody,
  extractFtBody,
  extractOgImage,
  isReadableSource,
  MAX_BODY_CHARS,
} from "./articleText";

describe("extractOgImage", () => {
  it("reads og:image in property-then-content order", () => {
    const html = `<meta property="og:image" content="https://cdn.example/a.jpg">`;
    expect(extractOgImage(html)).toBe("https://cdn.example/a.jpg");
  });

  it("reads og:image in content-then-property order", () => {
    const html = `<meta content="https://cdn.example/b.jpg" property="og:image">`;
    expect(extractOgImage(html)).toBe("https://cdn.example/b.jpg");
  });

  it("falls back to twitter:image", () => {
    const html = `<meta name="twitter:image" content="https://cdn.example/c.jpg">`;
    expect(extractOgImage(html)).toBe("https://cdn.example/c.jpg");
  });

  it("prefers og:image over twitter:image", () => {
    const html =
      `<meta name="twitter:image" content="https://cdn.example/tw.jpg">` +
      `<meta property="og:image" content="https://cdn.example/og.jpg">`;
    expect(extractOgImage(html)).toBe("https://cdn.example/og.jpg");
  });

  it("returns undefined when absent", () => {
    expect(extractOgImage("<html><head></head></html>")).toBeUndefined();
  });

  it("discards a RELATIVE image rather than guessing a host", () => {
    // A wrong image is worse than no image.
    expect(extractOgImage(`<meta property="og:image" content="/img/a.jpg">`)).toBeUndefined();
  });
});

describe("isReadableSource — the legal boundary", () => {
  it("allows bkhacken.se (robots: User-agent * / Disallow:)", () => {
    expect(isReadableSource("https://bkhacken.se/nyhet/foo")).toBe(true);
    expect(isReadableSource("https://www.bkhacken.se/nyhet/foo")).toBe(true);
  });

  it("allows fotbolltransfers.com (robots: User-agent * / Disallow:)", () => {
    expect(isReadableSource("https://fotbolltransfers.com/nyheter/foo/1")).toBe(true);
  });

  it("REFUSES expressen.se — paywalled AND scraping prohibited", () => {
    expect(isReadableSource("https://www.expressen.se/sport/fotboll/foo/")).toBe(false);
  });

  it("refuses other sources by default", () => {
    for (const u of [
      "https://www.svt.se/sport/fotboll/foo",
      "https://www.gp.se/nyheter/foo",
      "https://www.aftonbladet.se/sportbladet/a/foo",
      "https://allsvenskan.se/foo",
      "https://www.bollsvenskan.se/foo",
    ]) {
      expect(isReadableSource(u)).toBe(false);
    }
  });

  it("refuses a malformed url instead of throwing", () => {
    expect(isReadableSource("not a url")).toBe(false);
    expect(isReadableSource("")).toBe(false);
  });

  it("does not match a lookalike host", () => {
    // "notbkhacken.se" must not pass a naive substring check.
    expect(isReadableSource("https://notbkhacken.se/nyhet/foo")).toBe(false);
    expect(isReadableSource("https://bkhacken.se.evil.com/foo")).toBe(false);
  });
});

describe("extractBkhBody — bkhacken.se (div.html-text)", () => {
  const page = (inner: string) => `<html><body><div class="html-text text-lg">${inner}</div></body></html>`;

  it("extracts the story from the html-text container", () => {
    const body = extractBkhBody(page("<p>BK Häcken vann matchen med 2–0 på hemmaplan.</p>"));
    expect(body).toContain("BK Häcken vann matchen");
  });

  it("joins the lead and remainder containers", () => {
    const html =
      `<div class="html-text">Första stycket om matchen och laget i fråga, med tillräckligt många tecken.</div>` +
      `<div class="html-text text-base">Andra stycket med mer detaljer här, också tillräckligt långt för att räknas.</div>`;
    const body = extractBkhBody(html);
    expect(body).toContain("Första stycket");
    expect(body).toContain("Andra stycket");
  });

  it("ignores a container that is too short to be prose", () => {
    expect(extractBkhBody(`<div class="html-text">Kort</div>`)).toBe("");
  });
});

describe("extractFtBody — fotbolltransfers (div.article-text)", () => {
  it("extracts the story from the article-text container", () => {
    const html = `<div class="text-xl article-text">Simen Hestnes lämnade KFUM för BK Häcken i somras.</div>`;
    expect(extractFtBody(html)).toContain("Simen Hestnes lämnade KFUM");
  });

  it("does NOT return the site navigation", () => {
    // The generic strip returned "Logga in Kontakt Annonsera Nyheter …".
    const html =
      `<nav>Logga in Kontakt Annonsera Nyheter Övergångar Podd Ligor</nav>` +
      `<div class="article-text">Detta är själva artikeln om BK Häcken och laget.</div>`;
    const body = extractFtBody(html);
    expect(body).toContain("själva artikeln");
    expect(body).not.toContain("Annonsera");
  });

  it("returns the story ONCE when the page renders it twice (responsive branches)", () => {
    // Verbatim shape of the live page, 2026-10-20. fotbolltransfers renders the
    // body twice — once inside `fresnel-greaterThanOrEqual-md` (desktop) and
    // once inside `fresnel-lessThan-md` (mobile). Both are in the DOM and CSS
    // hides one, so joining every container published the article twice, the
    // second copy cut off mid-sentence by the character cap.
    const para = (t: string) => `<div class="text-xl article-text"><p>${t}</p></div>`;
    const html =
      `<div class="fresnel-container fresnel-greaterThanOrEqual-md">` +
      para("Mikkel Rygaard lämnade polska LKS Lodz för BK Häcken inför säsongen 2022.") +
      para("Han blev snabbt en nyckelspelare i laget och gjorde två mål i år.") +
      para("Den danske mittfältaren sitter på ett utgående kontrakt just nu.") +
      `</div>` +
      `<div class="fresnel-container fresnel-lessThan-md">` +
      para("Mikkel Rygaard lämnade polska LKS Lodz för BK Häcken inför säsongen 2022.") +
      para("Han blev snabbt en nyckelspelare i laget och gjorde två mål i år.") +
      para("Den danske mittfältaren sitter på ett utgående kontrakt just nu.") +
      `</div>`;
    const body = extractFtBody(html);
    expect(body.match(/lämnade polska LKS Lodz/g)).toHaveLength(1);
    expect(body.match(/utgående kontrakt/g)).toHaveLength(1);
  });

  it("keeps a lead + body pair that is NOT a duplicate (bkhacken shape)", () => {
    // bkhacken.se also has two html-text containers, but they are the lead
    // paragraph and the remainder of the story — different text. The dedupe
    // must not collapse them.
    const html =
      `<div class="html-text">Etrit Berisha höll nollan och Adrian Svanbäck gjorde matchens enda mål.</div>` +
      `<div class="html-text">Första halvlek var en jämn historia spelmässigt, men BK Häcken kom till fler lägen offensivt.</div>`;
    const body = extractBkhBody(html);
    expect(body).toContain("Etrit Berisha");
    expect(body).toContain("Första halvlek");
  });

  it("keeps a story that legitimately repeats a sentence", () => {
    // The dedupe compares PARAGRAPH RUNS, not individual sentences, so a
    // repeated line inside a real story is untouched.
    const html =
      `<div class="article-text">BK Häcken vann matchen med 2-0 på hemmaplan i går kväll.</div>` +
      `<div class="article-text">BK Häcken vann matchen med 2-0 på hemmaplan i går kväll.</div>` +
      `<div class="article-text">Tränaren var mycket nöjd med insatsen och berömde laget.</div>`;
    const body = extractFtBody(html);
    expect(body).toContain("Tränaren var mycket nöjd");
  });
});

describe("extractArticleBody — routing and cleanup", () => {
  it("routes bkhacken.se to the html-text extractor", () => {
    const html = `<div class="html-text">En tillräckligt lång text om BK Häcken och matchen i fråga.</div>`;
    expect(extractArticleBody(html, "https://bkhacken.se/nyhet/x")).toContain("BK Häcken");
  });

  it("routes fotbolltransfers to the article-text extractor", () => {
    const html = `<div class="article-text">En tillräckligt lång text om BK Häcken och matchen i fråga.</div>`;
    expect(extractArticleBody(html, "https://fotbolltransfers.com/nyheter/x/1")).toContain("BK Häcken");
  });

  it("falls back to the generic strip for an unlisted host", () => {
    const html = `<html><body><p>En text om något helt annat som är tillräckligt lång för att räknas.</p></body></html>`;
    expect(extractArticleBody(html, "https://example.com/a")).toContain("något helt annat");
  });

  it("strips the FT house promotion from the body", () => {
    // Present in 16 of 20 live bodies.
    const html =
      `<div class="article-text">Hestnes missade matcherna mot Halmstads BK.</div>` +
      `<div class="article-text">FT:s nya satsning - lyssna på Transferpodden:</div>` +
      `<div class="article-text">Han är tillbaka i truppen igen nu.</div>`;
    const body = extractArticleBody(html, "https://fotbolltransfers.com/nyheter/x/1");
    expect(body).not.toContain("Transferpodden");
    expect(body).toContain("Halmstads BK");
    expect(body).toContain("tillbaka i truppen");
  });

  it("removes the space an inline link leaves before punctuation", () => {
    // "BK Häcken</a>." became "BK Häcken ." in live bodies.
    const html = `<div class="article-text">Han skrev på för <a href="/klubb/27">BK Häcken</a> . Klart och färdigt nu.</div>`;
    const body = extractArticleBody(html, "https://fotbolltransfers.com/nyheter/x/1");
    expect(body).toContain("BK Häcken.");
    expect(body).not.toMatch(/\s+\./);
  });

  it("does NOT fall back to nav junk when the container is short", () => {
    // A brief story must not be replaced by the page navigation.
    const html =
      `<nav>Logga in Kontakt Annonsera Nyheter Övergångar Podd Ligor</nav>` +
      `<div class="article-text">Kort men äkta nyhet om BK Häcken.</div>`;
    const body = extractArticleBody(html, "https://fotbolltransfers.com/nyheter/x/1");
    expect(body).toContain("Kort men äkta nyhet");
    expect(body).not.toContain("Annonsera");
  });

  it("caps the body at MAX_BODY_CHARS", () => {
    // MAX_BODY_CHARS is the SERVED cap; MAX_CHARS (4000) is the synthesis cap.
    const long = "BK Häcken och laget. ".repeat(400);
    const html = `<div class="article-text">${long}</div>`;
    const body = extractArticleBody(html, "https://fotbolltransfers.com/nyheter/x/1");
    expect(body.length).toBeLessThanOrEqual(4000);
    expect(MAX_BODY_CHARS).toBeLessThanOrEqual(4000);
  });

  it("keeps paragraphs separated so the UI can render them", () => {
    const html =
      `<div class="article-text">Första stycket om matchen och laget i fråga.</div>` +
      `<div class="article-text">Andra stycket om något helt annat här.</div>`;
    const body = extractArticleBody(html, "https://fotbolltransfers.com/nyheter/x/1");
    expect(body.split("\n\n").length).toBeGreaterThan(1);
  });
});

describe("decodeEntities — RSS titles must not reach the screen as raw entities", () => {
  it("decodes the numeric entities the Allsvenskan feed actually publishes", () => {
    // Verbatim from the served feed, 2026-10-20. The RSS path stripped only
    // NAMED entities, so this title rendered literally in the app as
    // "Det blev Månadens Mål i september: &#8221;En delikat chipp&#8221;".
    const raw = "Det blev Månadens Mål i september: &#8221;En delikat chipp&#8221;";
    expect(decodeEntities(raw)).toBe("Det blev Månadens Mål i september: ”En delikat chipp”");
  });

  it("decodes hex numeric entities", () => {
    expect(decodeEntities("caf&#xE9; &#x2013; klart")).toBe("café – klart");
  });

  it("decodes the named entities Swedish feeds use", () => {
    expect(decodeEntities("H&auml;cken &amp; G&ouml;teborg")).toBe("Häcken & Göteborg");
    expect(decodeEntities("&ndash; &rdquo;citat&rdquo;")).toBe("– ”citat”");
  });

  it("leaves an unknown entity untouched instead of deleting it", () => {
    // The old RSS strip replaced every &[a-z]+; with a SPACE, silently eating
    // characters. An entity we do not know must survive verbatim.
    expect(decodeEntities("50&unknownthing; kvar")).toBe("50&unknownthing; kvar");
  });

  it("does not double-decode an escaped ampersand", () => {
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
  });
});
