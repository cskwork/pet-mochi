import type { PetState } from "./state";

/**
 * Keepsake gifts (PRD §27.5, REQ-109).
 *
 * After sustained good care, Mochi leaves a small trinket, persisted as a
 * durable memory of type {@link KEEPSAKE_MEMORY_TYPE}. Research finding #3:
 * the pet *giving back* is the strongest attachment mechanic (Neko Atsume
 * mementos). Pure module — the caller owns IO and timing.
 */

export type Trinket = { icon: string; name: string };

export const TRINKETS: readonly Trinket[] = [
  { icon: "🍂", name: "a crisp autumn leaf" },
  { icon: "🪨", name: "a perfectly round pebble" },
  { icon: "🧵", name: "a bit of soft string" },
  { icon: "🌸", name: "a pressed blossom" },
  { icon: "🫧", name: "a bubble that didn't pop" },
  { icon: "🍀", name: "a lucky clover" },
  { icon: "🎀", name: "a tiny ribbon" },
  { icon: "🐚", name: "a whispering shell" },
  { icon: "⭐", name: "a star sticker" },
  { icon: "🍬", name: "a wrapped candy (unopened)" },
  { icon: "🪶", name: "a very soft feather" },
  { icon: "🔘", name: "a shiny button" },
] as const;

export const KEEPSAKE_MEMORY_TYPE = "keepsake";
export const KEEPSAKE_MIN_AFFECTION = 70;
export const KEEPSAKE_MIN_TRUST = 55;
export const KEEPSAKE_SPACING_MS = 20 * 60 * 60 * 1000;

/**
 * Gate: good care right now AND enough spacing since the last keepsake.
 * A present-but-unparseable timestamp returns false (don't spam on corrupt
 * state — the next persisted keepsake rewrites a clean value). Null means
 * "never gifted" and is allowed.
 */
export function canLeaveKeepsake(
  state: PetState,
  lastKeepsakeAtIso: string | null,
  now: number,
): boolean {
  if (state.affection < KEEPSAKE_MIN_AFFECTION) return false;
  if (state.trust < KEEPSAKE_MIN_TRUST) return false;
  if (lastKeepsakeAtIso === null) return true;
  const last = Date.parse(lastKeepsakeAtIso);
  if (Number.isNaN(last)) return false;
  return now - last >= KEEPSAKE_SPACING_MS;
}

/**
 * Deterministic trinket for (pet, calendar day) so a restart on the same day
 * cannot re-roll a different gift.
 */
export function pickTrinket(petId: string, dateIso: string): Trinket {
  const day = dateIso.slice(0, 10); // YYYY-MM-DD
  const h = fnv1a(`${petId}|${day}`);
  return TRINKETS[h % TRINKETS.length];
}

/** Memory row content — the shelf renders this verbatim. */
export function keepsakeMemoryContent(t: Trinket): string {
  return `${t.icon} ${t.name} — found for you`;
}

export function keepsakeBubble(petName: string, t: Trinket): string {
  return `${petName}: for you! ${t.icon} ♡`;
}

/** Newest keepsake timestamp from a memory list (restart path); null if none. */
export function lastKeepsakeAt(
  memories: readonly { type: string; createdAt: string }[],
): string | null {
  let newest: string | null = null;
  for (const m of memories) {
    if (m.type !== KEEPSAKE_MEMORY_TYPE) continue;
    if (newest === null || m.createdAt > newest) newest = m.createdAt;
  }
  return newest;
}

function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h | 0);
}
