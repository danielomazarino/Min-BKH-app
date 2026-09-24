import type { Competition } from "./types";

export interface CompetitionRule {
  competition: Competition;
  season: string;
  rule: string;
  threshold: number;
  suspensionMatches: number;
  ruleSource: string;
  ruleSourceUrl: string;
}

import ruleJson from "./rules/allsvenskan.json";

export const allsvenskanRule: CompetitionRule = ruleJson as CompetitionRule;

export function getRule(competition: Competition, season: string): CompetitionRule | null {
  if (competition === "allsvenskan" && season === allsvenskanRule.season) {
    return allsvenskanRule;
  }
  return null;
}
