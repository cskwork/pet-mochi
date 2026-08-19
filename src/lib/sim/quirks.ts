import type { AnimationStep } from "./actions";
import type { Mood, MovementState, PetState } from "./state";

/**
 * Idle micro-quirks (PRD §27.4, REQ-106).
 *
 * When the pet is idle and unhurried, it occasionally plays a short 1–3 beat
 * chain composed from existing poses so idle life feels non-repetitive without
 * any LLM involvement. Pure: callers persist `lastQuirkAt` themselves and
 * inject `rng` for deterministic tests.
 */

export type QuirkChain = {
  /** Stable key for logging/tests. */
  key: string;
  steps: AnimationStep[];
};

/** Minimum quiet time between two quirks. */
export const QUIRK_COOLDOWN_MS = 45_000;

/** Fire probability per eligible tick (scaled by animation intensity). */
export const QUIRK_CHANCE = 0.3;

/** Quirks only trigger from calm resting poses — never mid-walk or asleep. */
export const QUIRK_ELIGIBLE_ANIMATIONS: ReadonlySet<MovementState> = new Set<
  MovementState
>(["idle", "sit", "look_cursor"]);

/**
 * Mood-weighted pools. Every chain uses only existing MovementState poses so
 * no new art is required; the REQ-015 expressive set finally shows up in
 * ordinary idle life instead of being choreography-only.
 */
export const QUIRK_POOLS: Record<Mood, readonly QuirkChain[]> = {
  happy: [
    { key: "happy_wiggle", steps: [{ animation: "wiggle", durationMs: 600 }] },
    {
      key: "happy_roll",
      steps: [
        { animation: "roll", durationMs: 550 },
        { animation: "jump", durationMs: 420 },
      ],
    },
    {
      key: "happy_stretch",
      steps: [
        { animation: "stretch", durationMs: 650 },
        { animation: "wiggle", durationMs: 500 },
      ],
    },
  ],
  curious: [
    {
      key: "curious_tilt",
      steps: [
        { animation: "tilt_head", durationMs: 600 },
        { animation: "peek", durationMs: 600 },
      ],
    },
    {
      key: "curious_scan",
      steps: [
        { animation: "peek", durationMs: 500 },
        { animation: "look_cursor", durationMs: 600 },
      ],
    },
  ],
  tired: [
    {
      key: "tired_yawn",
      steps: [
        { animation: "yawn", durationMs: 700 },
        { animation: "stretch", durationMs: 600 },
      ],
    },
    {
      key: "tired_slump",
      steps: [
        { animation: "stretch", durationMs: 700 },
        { animation: "sit", durationMs: 500 },
      ],
    },
  ],
  hungry: [
    {
      key: "hungry_sniff",
      steps: [
        { animation: "look_cursor", durationMs: 500 },
        { animation: "tilt_head", durationMs: 600 },
      ],
    },
  ],
  bored: [
    {
      key: "bored_shuffle",
      steps: [
        { animation: "stretch", durationMs: 600 },
        { animation: "sit", durationMs: 500 },
      ],
    },
    {
      key: "bored_restless",
      steps: [
        { animation: "tilt_head", durationMs: 500 },
        { animation: "shake", durationMs: 420 },
      ],
    },
  ],
  lonely: [
    {
      key: "lonely_peek",
      steps: [
        { animation: "peek", durationMs: 700 },
        { animation: "sit", durationMs: 600 },
      ],
    },
  ],
};

/**
 * Decide whether a quirk fires this tick. Returns the chain to play or null.
 *
 * `chanceScale` maps the `animationIntensity` setting (REQ-113): 0 disables
 * quirks entirely, values are clamped to [0, 1] before scaling the base
 * probability.
 */
export function nextQuirk(
  state: PetState,
  lastQuirkAt: number | null,
  now: number,
  rng: () => number = Math.random,
  chanceScale = 1,
): QuirkChain | null {
  if (!QUIRK_ELIGIBLE_ANIMATIONS.has(state.currentAnimation)) return null;
  if (lastQuirkAt !== null && now - lastQuirkAt < QUIRK_COOLDOWN_MS) return null;
  const chance = QUIRK_CHANCE * Math.max(0, Math.min(1, chanceScale));
  if (chance <= 0) return null;
  if (rng() >= chance) return null;
  const pool = QUIRK_POOLS[state.mood];
  const idx = Math.min(pool.length - 1, Math.max(0, Math.floor(rng() * pool.length)));
  return pool[idx];
}
