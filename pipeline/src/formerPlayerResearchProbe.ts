/**
 * DEV-ONLY harness: bounded former-player research probe.
 *
 * NOT part of the production pipeline. `npm run pipeline` never imports this.
 * It researches a SMALL, hand-picked set of players chosen to cover distinct
 * situations (clearly active, recently transferred, likely retired, identity
 * ambiguity, public vs unavailable contract info) and prints the structured
 * result together with the grounding sources, so every claim can be checked
 * by hand before any decision is made about scaling up.
 *
 * It WRITES NOTHING: registry.json, public/data and API-Football are all
 * left untouched. The point is evidence, not data.
 *
 * Requires GEMINI_API_KEY. Exits non-zero if any response fails validation.
 *
 *   GEMINI_API_KEY=... npx tsx pipeline/src/formerPlayerResearchProbe.ts
 */
import { loadRegistry } from "./registry";
import { researchPlayer, type ResearchInput } from "./geminiResearch";

/**
 * Hand-picked cases. Each exists to probe a specific risk, not to be a
 * representative sample of all 31.
 */
const CASES: Array<{ id: string; why: string }> = [
  { id: "juloan-hamad", why: "Recently transferred abroad (Japan) — is he still there now?" },
  { id: "erion-sadiku", why: "Clear identity/ambiguity risk: common Albanian name, also a coach" },
  { id: "david-frolund", why: "Name change (David Marek -> Frölund); long Häcken career" },
  { id: "andersson-placeholder", why: "REMOVED at runtime" },
  { id: "oscar-lewicki", why: "Likely retired — tests that retirement is not guessed" },
  { id: "simon-gustafson", why: "Potentially retired/assistant role; Swedish sources" },
  { id: "benjamin-acquah", why: "Ghanaian international — club/league/country resolution" },
  { id: "emil-krafth", why: "Older former player — likely retired, no contract info" },
  { id: "mohammed-ali-khan", why: "Ambiguous short name; possible confusion with others" },
];

async function main(): Promise<void> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error("GEMINI_API_KEY is not set. Nothing to test.");
    process.exit(2);
  }

  const wanted = CASES.filter((c) => c.id !== "andersson-placeholder");
  const registry = loadRegistry();
  const byId = new Map(registry.map((e) => [e.id, e]));

  const inputs: ResearchInput[] = [];
  for (const c of wanted) {
    const entry = byId.get(c.id);
    if (!entry) {
      console.error(`SKIP ${c.id}: not in registry.json`);
      continue;
    }
    inputs.push({
      id: entry.id,
      name: entry.name,
      aliases: entry.aliases,
      bkhSeasons: entry.bkhSeasons,
    });
  }

  console.log(`Researching ${inputs.length} players (bounded, one request each):`);
  for (const i of inputs) console.log(`  - ${i.id} (${i.name}) :: ${wanted.find((c) => c.id === i.id)?.why}`);
  console.log("");

  const results = new Map<string, Awaited<ReturnType<typeof researchPlayer>>>();
  let totalCalls = 0;
  let failures = 0;

  for (const input of inputs) {
    console.log(`--- ${input.id} (${input.name}) ---`);
    const r = await researchPlayer(input, key);
    totalCalls += r.calls;
    results.set(input.id, r);

    console.log(
      `  ok=${r.research !== null} model=${r.model ?? "none"} calls=${r.calls} grounded=${r.grounded}` +
        (r.error ? ` error="${r.error}"` : ""),
    );
    if (!r.research) {
      failures++;
      console.log("  NO VALID RESEARCH RESULT");
      continue;
    }
    const p = r.research;
    const line = (label: string, f: { value: unknown; status: string; confidence: string; sourceUrl?: string; note?: string }) =>
      console.log(
        `  ${label.padEnd(22)} ${String(f.value ?? "UNKNOWN").slice(0, 46).padEnd(48)}` +
          `[${f.status}/${f.confidence}]` +
          (f.sourceUrl ? ` src=${f.sourceUrl.slice(0, 72)}` : " src=—"),
      );
    line("identity", p.identity);
    line("  aliases", { ...p.identity, value: (p.identity.aliases ?? []).join(", ") });
    line("bkh relationship", p.bkhackenRelationship);
    line("  team", { ...p.bkhackenRelationship, value: p.bkhackenRelationship.team });
    line("activityStatus", { ...p.activityStatus, value: p.activityStatus.value });
    line("currentClub", p.currentClub);
    line("currentLeague", p.currentLeague);
    line("currentCountry", p.currentCountry);
    line("contractExpiry", p.contractExpiry);
    line("contractNature", { ...p.contractNature, value: p.contractNature.value });
    line("careerNotes", p.careerNotes);
    console.log(`  verifiedAt            ${p.researchedAt}`);
    console.log(`  sources (${p.sources.length}):`);
    for (const s of p.sources.slice(0, 6)) {
      console.log(`    - [${s.publisher ?? "?"}] ${s.url.slice(0, 100)}`);
    }
    if (p.identity.note) console.log(`  identity note: ${p.identity.note}`);
    if (p.activityStatus.note) console.log(`  status note: ${p.activityStatus.note}`);
    if (p.contractExpiry.note) console.log(`  contract note: ${p.contractExpiry.note}`);
    console.log("");
  }

  console.log("=== SUMMARY ===");
  console.log(`total API calls: ${totalCalls}`);
  console.log(`players researched: ${results.size}`);
  console.log(`validation failures: ${failures}`);
  const grounded = [...results.values()].filter((r) => r.grounded).length;
  console.log(`grounded (web-sourced): ${grounded}/${results.size}`);
  const unknowns = [...results.values()].filter(
    (r) => r.research?.contractExpiry.status === "unknown",
  ).length;
  console.log(`contractExpiry UNKNOWN (correct restraint): ${unknowns}`);
  process.exit(failures > 0 ? 3 : 0);
}

main();
