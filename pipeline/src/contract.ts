import type { Provenance, VerificationStatus } from "./types";

/**
 * Contract verification model.
 *
 * NEVER display an unverified contract date as a confirmed fact. Possible
 * states: confirmed | reported | unverified | unknown.
 */

export interface ContractClaimInput {
  claim: string;
  sourceName: string;
  sourceUrl?: string;
  publishedAt?: string;
  retrievedAt: string;
  discoveredVia: string;
  /** Is the source the club/league/player (primary) or media? */
  evidenceType: "primary_official" | "player_interview" | "reported_media" | "rumour" | "database_only";
}

export function contractVerificationStatus(evidenceType: ContractClaimInput["evidenceType"]): VerificationStatus {
  switch (evidenceType) {
    case "primary_official":
      return "confirmed";
    case "player_interview":
      return "reported";
    case "reported_media":
      return "reported";
    case "rumour":
      return "unverified";
    case "database_only":
      return "unverified";
  }
}

/** Build contract info with provenance; null when there is no credible claim. */
export function buildContractInfo(input: ContractClaimInput | null): Provenance & { contractStatus: string } | null {
  if (!input) return null;
  const status = contractVerificationStatus(input.evidenceType);
  return {
    contractStatus: status,
    sourceName: input.sourceName,
    sourceUrl: input.sourceUrl,
    publishedAt: input.publishedAt,
    retrievedAt: input.retrievedAt,
    discoveredVia: input.discoveredVia,
    verificationStatus: status,
  };
}

/** UI phrasing: never a hard date unless verified. */
export function contractExpiryPhrase(expiry: string | undefined, status: VerificationStatus): string {
  if (!expiry) return "Ingen verifierad utgång hittad.";
  if (status === "confirmed") return `Kontraktet löper till ${expiry}.`;
  if (status === "reported") return `Kontraktet rapporteras löpa till ${expiry}.`;
  return "Ingen verifierad utgång hittad.";
}
