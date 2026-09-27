/**
 * Guards on the Gemini evaluation FIXTURE.
 *
 * The fixture is test data, and test data rots silently. These tests pin the
 * four properties that make the evaluation a FAIR comparison rather than a
 * rigged one.
 *
 * WHY THE SOURCE IS READ AS TEXT INSTEAD OF IMPORTED
 *   `geminiSemanticEval.ts` calls `main()` at module scope and that function
 *   performs the single Gemini request and `process.exit`s. Importing it from
 *   a test would fire a real request. The fixture is therefore read from the
 *   source file, which also lets us assert on the ONE-FETCH guarantee itself.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(__dirname, "geminiSemanticEval.ts"), "utf8");

/** The `const ARTICLES ... = [ ... ];` block. */
const fixtureBlock = (() => {
  const start = SRC.indexOf("const ARTICLES");
  const end = SRC.indexOf("\n];", start);
  return SRC.slice(start, end);
})();

interface ParsedArticle {
  id: string;
  title: string;
  summary?: string;
  url: string;
}

function parseArticles(): ParsedArticle[] {
  const out: ParsedArticle[] = [];
  // Each fixture article is exactly one line, so parse per line rather than
  // with one greedy multi-line regex. Field order in the literal is
  // `id, publisher, title, summary, url, ...`, but each is matched by NAME so
  // reordering the literal cannot silently break the parse — and a MISSING
  // summary surfaces as `undefined` instead of being skipped over.
  for (const line of fixtureBlock.split("\n")) {
    const m = /^\s*\{\s*id:\s*"(t\d)"/.exec(line);
    if (!m) continue;
    const grab = (field: string): string | undefined => {
      const r = new RegExp(`${field}:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(line);
      return r?.[1];
    };
    out.push({
      id: m[1],
      title: grab("title") ?? "",
      summary: grab("summary"),
      url: grab("url") ?? "",
    });
  }
  return out;
}

const ARTICLES = parseArticles();

/**
 * Real bkhacken.se `<description>` values measured 2026-09-27 run 57-152
 * characters. The ceiling is the important half: a future edit that pastes
 * whole-article text into `summary` would make Gemini's synthesis look
 * trivially better than the baseline, manufacturing the result under test.
 */
const RSS_MIN = 40;
const RSS_CEILING = 152;

describe("Gemini eval fixture — summaries", () => {
  it("parses all eight fixture articles", () => {
    expect(ARTICLES).toHaveLength(8);
    expect(ARTICLES.map((a) => a.id).sort()).toEqual(["t1", "t2", "t3", "t4", "t5", "t6", "t7", "t8"]);
  });

  // Without this, pickSummary() falls back to the title and every baseline
  // event is reported as summaryMethod:"excerpt" with a repeated headline.
  it("gives EVERY article a non-empty summary", () => {
    for (const a of ARTICLES) {
      expect(a.summary, `${a.id} has no summary`).toBeTruthy();
      expect(a.summary!.trim().length, `${a.id} summary is blank`).toBeGreaterThan(0);
    }
  });

  it("never repeats the article's own title as its summary", () => {
    for (const a of ARTICLES) {
      expect(a.summary!.trim(), `${a.id} summary is its title`).not.toBe(a.title.trim());
    }
  });

  it("keeps summaries in the RSS register, never full-article text", () => {
    for (const a of ARTICLES) {
      expect(a.summary!.length, `${a.id} too short to be a real teaser`).toBeGreaterThanOrEqual(RSS_MIN);
      expect(a.summary!.length, `${a.id} too long — this would rig the comparison`).toBeLessThanOrEqual(RSS_CEILING);
    }
  });

  // The prefilter's literal-mention rule is unchanged, and t2/t4 must still
  // drop on hard rules alone to stay in EXPECTED_DROPPED.
  it("keeps t2 and t4 free of the word 'Häcken' so they still drop", () => {
    for (const id of ["t2", "t4"]) {
      const a = ARTICLES.find((x) => x.id === id)!;
      expect(`${a.title} ${a.summary}`, `${id} mentions Häcken`).not.toMatch(/Häcken/i);
    }
  });

  // The two articles that must be REJECTED as women's have to look plausible,
  // otherwise the discrimination test proves nothing.
  it("gives the women's articles summaries that read as plausible men's items", () => {
    const t7 = ARTICLES.find((a) => a.id === "t7")!;
    const t8 = ARTICLES.find((a) => a.id === "t8")!;
    // They must be substantive, not placeholders.
    expect(t7.summary!.length).toBeGreaterThan(RSS_MIN);
    expect(t8.summary!.length).toBeGreaterThan(RSS_MIN);
    // And they must not assert a result the source never states: t7's body
    // gives no score, and inventing one would poison the traceability audit.
    expect(t7.summary).not.toMatch(/\d\s*[–-]\s*\d/);
  });
});

describe("Gemini eval fixture — the one-request guarantee", () => {
  it("still contains exactly ONE fetch to the Gemini endpoint", () => {
    expect(SRC.match(/await fetch\(/g) ?? []).toHaveLength(1);
    // And it targets generateContent, not some helper.
    expect(SRC).toMatch(/await fetch\(ENDPOINT/);
  });

  it("still has no retry and no model fallback", () => {
    // Comments may mention these words; executable code may not.
    const code = SRC.replace(/^\s*(\*|\/\/).*$/gm, "");
    expect(code).not.toMatch(/synthesizeWithGemini/);
    expect(code).not.toMatch(/--retry/);
    // A single pinned model, not a candidate list.
    expect(code).not.toMatch(/DEFAULT_MODELS/);
    expect(SRC).toMatch(/const MODEL = process\.env\.GEMINI_MODEL \?\? "gemini-3\.8-flash"/);
  });

  it("still keeps the fixture guard that aborts before the request", () => {
    // The guard must sit BEFORE the single fetch in source order, otherwise
    // an invalid fixture would still cost a request.
    const guard = SRC.indexOf("fixture-invalid");
    const fetchAt = SRC.indexOf("await fetch(ENDPOINT");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(fetchAt);
  });
});
