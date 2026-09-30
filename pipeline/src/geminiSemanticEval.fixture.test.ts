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

/* ------------------------------------------------------------------------ *
 * B-004 — the missing grouping assertion.
 *
 * Every other test in this file grades FIXTURE QUALITY. None of them grades
 * GROUPING, which is why the evaluation could pass while production shipped
 * the false merge. This block closes that gap.
 *
 * THE DEFECT (root cause, established — do not re-investigate)
 *   SYSTEM_INSTRUCTION in pipeline/src/gemini.ts says:
 *     "Artiklar om samma match ... hör till samma händelse,
 *      ÄVEN om rubrikerna skiljer sig helt."
 *   A pre-match MATCHTRUPP announcement and a post-match MATCHRAPPORT are
 *   both "samma match", so this line actively COMMANDS the false merge. It
 *   is not a missing guard — it is a positive instruction to do the wrong
 *   thing. Every false merge observed in production has this shape.
 *
 * WHY THE PROMPT IS READ AS TEXT, NOT IMPORTED
 *   SYSTEM_INSTRUCTION is module-scope and unexported. Importing the module
 *   would be legitimate (gemini.ts has no main()/process.exit), but the
 *   constant is not exported, so the source is read instead. This keeps the
 *   zero-request guarantee: nothing here executes a fetch.
 *
 * WHAT THIS TEST CAN AND CANNOT PROVE
 *   It asserts the CONTRACT — that the prompt no longer instructs the merge.
 *   It CANNOT prove Gemini obeys a corrected prompt; that needs a live call.
 *   This test is what makes such a call worth spending. See Part 4 of the
 *   task: the blocker is the VALIDATION PATH, not capacity, not quota.
 * ------------------------------------------------------------------------ */

/** `gemini.ts` source. Read as text — never imported for its side effects. */
const GEMINI_SRC = readFileSync(resolve(__dirname, "gemini.ts"), "utf8");

/**
 * The SYSTEM_INSTRUCTION template literal, exactly as Gemini receives it.
 *
 * EXTRACTION IS ASSERTED, NOT ASSUMED (hardened 2026-09-30)
 *   The first version used a bare `indexOf` pair with no failure check. Probed
 *   consequences of a RENAME of the constant:
 *     - `start` becomes -1, `from` becomes 19, and the function silently
 *       returns ~1100 characters of the file header instead of the prompt.
 *   That string still fails the vocabulary assertion, so the test kept LOOKING
 *   correct while testing nothing. Worse, if the header text happened to contain
 *   both vocabularies the assertion would PASS VACUOUSLY. A test that cannot
 *   distinguish "the prompt is wrong" from "my extraction is broken" is not a
 *   specification, so a failed extraction now throws.
 *
 * TRIM POLICY: the extracted text is trimmed of surrounding whitespace, so a
 * trailing space before the closing backtick (probed: verdict unchanged either
 * way) can never leave a stray delimiter in the analysed string.
 */
const systemInstruction = (() => {
  const head = "const SYSTEM_INSTRUCTION = `";
  const start = GEMINI_SRC.indexOf(head);
  if (start < 0) {
    throw new Error(
      "EXTRACTION FAILED: `const SYSTEM_INSTRUCTION = \\`` not found in gemini.ts.\n" +
        "The constant was probably renamed. The B-004 assertion below would " +
        "otherwise test whatever text happened to precede it.",
    );
  }
  const from = start + head.length;
  const end = GEMINI_SRC.indexOf("`;", from);
  if (end <= from) {
    throw new Error(
      "EXTRACTION FAILED: closing `; not found after `const SYSTEM_INSTRUCTION = \\``.\n" +
        "The template literal is unterminated or was reformatted to not end in `;.",
    );
  }
  const extracted = GEMINI_SRC.slice(from, end).trim();
  if (extracted.length < 200) {
    throw new Error(
      `EXTRACTION FAILED: only ${extracted.length} characters extracted, expected a ` +
        "multi-sentence prompt. Refusing to run a vocabulary assertion on it.",
    );
  }
  // If the literal no longer ends in `;` the scan runs past it and swallows the
  // rest of the file — probed at 12432 chars, which still clears the length
  // floor above. A stray backtick is the reliable signal that we escaped the
  // literal, so treat one as extraction failure rather than analysing the file.
  if (extracted.includes("`") || extracted.length > 5000) {
    throw new Error(
      `EXTRACTION FAILED: extracted ${extracted.length} characters and crossed a ` +
        "template-literal boundary. The literal probably no longer ends in `;.",
    );
  }
  return extracted;
})();

/** `publishedAt` for one fixture article, read straight from the literal. */
function publishedAtOf(id: string): string {
  const line = fixtureBlock
    .split("\n")
    .find((l) => new RegExp(`\\bid:\\s*"${id}"`).test(l));
  return /publishedAt:\s*"([^"]+)"/.exec(line ?? "")?.[1] ?? "";
}

/**
 * Vocabulary for the pre/post boundary, deliberately WIDE.
 *
 * These patterns express INTENT, not one expected phrasing. A correct Swedish
 * fix might say "information före avspark", "matchen som inte ännu spelats" or
 * "efter att matchen spelats" — all satisfy the rule, all must be accepted.
 * Narrow patterns would leave a red test on correct code, which is a tripwire
 * rather than a contract.
 *
 * They remain NARROW ENOUGH not to match the pre-fix prompt — verified by
 * running this file BEFORE the prompt was edited and observing the intended
 * red failure rather than a vacuous pass.
 */
const PRE_MATCH =
  /\b(matchtrupp|förhands|förberedelse|förmatch|prematch|besöksinformation)\b|före\s+(?:avspark|matchen|match)|\binnan\s+matchen?\b|inte\s+ännu\s+spelad/i;
const POST_MATCH =
  /\b(matchrapport|matchreferat|resultatet|resultat|referat)\b|efter\s+(?:att\s+)?(?:matchen\s+)?(?:spelad|avspark)|(?:när|efter)\s+matchen\s+(?:spelad|var)\b|\bresultatet\s+av\b/i;

describe("B-004 — pre-match and post-match must not share an event", () => {
  // Structural fact, and the reason the merge is FALSE rather than a judgement
  // call. These two assertions PASS today; they exist to pin the fixture so
  // the regression cannot be deleted by editing the offending articles away.
  it("fixture really does straddle one match: t1 pre, t3-t6 post", () => {
    const pre = publishedAtOf("t1");
    const posts = ["t3", "t4", "t5", "t6"].map(publishedAtOf);

    expect(pre, "t1 lost its publishedAt").toBeTruthy();
    for (const p of posts) expect(p, "a post-match article lost its publishedAt").toBeTruthy();

    // A full day apart, and the announcements sit BEFORE every report.
    for (const p of posts) {
      expect(
        new Date(pre) < new Date(p),
        `t1 (${pre}) must predate ${p} (${p})`,
      ).toBe(true);
    }
    expect(Math.round((+new Date(posts[0]) - +new Date(pre)) / 86_400_000)).toBe(1);
  });

  it("t1 is the squad announcement, t3-t6 the reports — one card cannot stand for both", () => {
    const t1 = ARTICLES.find((a) => a.id === "t1")!;
    expect(`${t1.title} ${t1.summary}`, "t1 is no longer the matchtrupp announcement")
      .toMatch(/matchtrupp/i);

    // t3-t6 all report the RESULT of the match t1 only announced.
    for (const id of ["t3", "t4", "t5", "t6"]) {
      const a = ARTICLES.find((x) => x.id === id)!;
      expect(`${a.title} ${a.summary}`, `${id} no longer reports a played result`)
        .toMatch(/hattrick|5–0|besegrade|krossade|säkrade/i);
    }
  });

  // ── THE DELIVERABLE. This is the assertion that must FAIL today. ──────────
  //
  // SYSTEM_INSTRUCTION currently carries no rule that separates the two sides
  // of the match boundary, while explicitly instructing that "samma match"
  // always merges. A prompt test is the one honest assertion available with
  // zero Gemini requests: the grouping decision itself is made by the model
  // at runtime and cannot be graded offline.
  it("SYSTEM_INSTRUCTION must not command the false merge (t1 must not join t3-t6)", () => {
    const addressesBothSides =
      PRE_MATCH.test(systemInstruction) && POST_MATCH.test(systemInstruction);

    expect(
      addressesBothSides,
      [
        "B-004: SYSTEM_INSTRUCTION saknar en regel som skiljer förhands- från efterhandsmaterial.",
        "Without it the prompt still says 'Artiklar om samma match ... hör till samma händelse,",
        " ÄVEN om rubrikerna skiljer sig helt' — which groups the pre-match squad announcement",
        " t1 (19 sep, matchtrupp) together with the post-match reports t3-t6 (20 sep, hattrick/5-0).",
        " That is one card standing in for two different stories, on either side of the same match.",
      ].join("\n"),
    ).toBe(true);
  });
});
