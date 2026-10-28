import type { AnimationStep } from "./actions";
import { DEFAULT_PERSONALITY, type PersonalityParams, type PersonalityPreset } from "./personality";
import type { Mood, MovementState, PetState } from "./state";

/**
 * Hover reaction (USER_HOVERED_PET). When the cursor enters the pet, she
 * plays a tiny 1–2 beat acknowledgement chosen by mood and personality.
 * Deterministic and local: never calls the LLM, never makes sound. Pure —
 * the caller tracks `lastHoverAt` and checks action/drag state.
 */

/** Minimum time between two hover reactions. */
export const HOVER_COOLDOWN_MS = 20_000;

/** Poses a hover may interrupt — calm or ambling, never asleep. */
export const HOVER_ELIGIBLE_ANIMATIONS: ReadonlySet<MovementState> = new Set<MovementState>([
  "idle",
  "sit",
  "look_cursor",
  "walk",
]);

const MOOD_REACTIONS: Record<Mood, AnimationStep[]> = {
  happy: [
    { animation: "blush", durationMs: 450 },
    { animation: "wiggle", durationMs: 400 },
  ],
  curious: [
    { animation: "tilt_head", durationMs: 500 },
    { animation: "peek", durationMs: 400 },
  ],
  tired: [{ animation: "yawn", durationMs: 550 }],
  hungry: [
    { animation: "look_cursor", durationMs: 400 },
    { animation: "tilt_head", durationMs: 450 },
  ],
  bored: [{ animation: "wiggle", durationMs: 450 }],
  lonely: [
    { animation: "nuzzle", durationMs: 500 },
    { animation: "blush", durationMs: 400 },
  ],
};

const PRESET_REACTIONS: Record<PersonalityPreset, AnimationStep[][]> = {
  curious: [
    [{ animation: "tilt_head", durationMs: 500 }],
    [{ animation: "peek", durationMs: 450 }],
  ],
  lazy: [[{ animation: "yawn", durationMs: 500 }], [{ animation: "blush", durationMs: 450 }]],
  playful: [
    [
      { animation: "jump", durationMs: 380 },
      { animation: "wiggle", durationMs: 400 },
    ],
    [{ animation: "celebrate", durationMs: 450 }],
  ],
  quiet: [[{ animation: "blush", durationMs: 450 }]],
};

/**
 * The reaction to play for a cursor-enter at `now`, or null (cooldown,
 * asleep/busy pose). Picks uniformly between the mood reaction and the
 * preset's own reactions.
 */
export function hoverReaction(
  state: PetState,
  lastHoverAt: number | null,
  now: number,
  rng: () => number = Math.random,
  personality: PersonalityParams = DEFAULT_PERSONALITY,
): AnimationStep[] | null {
  if (!HOVER_ELIGIBLE_ANIMATIONS.has(state.currentAnimation)) return null;
  if (lastHoverAt !== null && now - lastHoverAt < HOVER_COOLDOWN_MS) return null;
  const pool = [MOOD_REACTIONS[state.mood], ...PRESET_REACTIONS[personality.preset]];
  const idx = Math.min(pool.length - 1, Math.max(0, Math.floor(rng() * pool.length)));
  return pool[idx];
}
