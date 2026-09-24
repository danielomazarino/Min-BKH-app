import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Former-player registry.
 *
 * Provenance: initial curated list based on publicly documented former BK
 * Häcken players (Wikipedia BK Häcken player history + public transfer
 * records). Each entry is easy to extend; apiFootballId is filled when
 * reliably known. We do NOT fabricate club/contract data here — those fields
 * are populated by the pipeline from verified sources, or left null with
 * clubVerified=false.
 */

export interface RegistryEntry {
  id: string;
  name: string;
  aliases?: string[];
  /** Seasons at BK Häcken (men's first team). */
  bkhSeasons: string;
  apiFootballId?: number;
  /** Known current club id in API-Football, when reliably known. */
  apiFootballTeamId?: number;
  notes?: string;
}

const REGISTRY_PATH = resolve(import.meta.dirname, "registry.json");

export function loadRegistry(): RegistryEntry[] {
  if (!existsSync(REGISTRY_PATH)) return [];
  return JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as RegistryEntry[];
}

export function saveRegistry(entries: RegistryEntry[]): void {
  writeFileSync(REGISTRY_PATH, JSON.stringify(entries, null, 2));
}
