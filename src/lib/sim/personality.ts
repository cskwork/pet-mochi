import type { AnimationStep } from "./actions";
import type { Mood, MovementState } from "./state";

/**
 * Personality presets (Settings → Personality). Pure parameter tables that the
 * tick, movement, decay, quirk, nudge, and hover code read. `curious` is the
 * historical behavior: every dial is the identity, so existing tests and
 * existing pets are unchanged. Other presets nudge the dials modestly — they
 * flavor the pet, they never make her needier or guilt the user.
 */

export type PersonalityPreset = "curious" | "lazy" | "playful" | "quiet";

export const PERSONALITY_PRESETS: readonly PersonalityPreset[] = [
  "curious",
  "lazy",
  "playful",
  "quiet",
] as const;

/** Extra idle quirk chain a preset adds, limited to moods where it fits. */
export type PersonalityQuirk = {
  key: string;
  steps: AnimationStep[];
  moods: readonly Mood[];
};

export type PersonalityParams = {
  preset: PersonalityPreset;
  /** Multiplies the base quirk chance (after the intensity clamp). */
  quirkChanceScale: number;
  /** Chains appended to the mood pool for matching moods. */
  extraQuirks: readonly PersonalityQuirk[];
  /** Relative weights for the calm idle variants in `chooseMovement`. */
  idleWeights: { idle: number; sit: number; look_cursor: number };
  /** Walk once boredom exceeds this (wander frequency). */
  walkBoredom: number;
  /** Multiplies the wander step size. */
  wanderStepScale: number;
  /** Daytime sleep entry: energy below this. */
  sleepEnergy: number;
  /** Night sleep entry (REQ-119): energy below this while boredom < 60. */
  nightSleepEnergy: number;
  /** Multiplies both nudge cooldowns (higher = fewer nudges). */
  nudgeCooldownScale: number;
  /** Multiplies the awake energy drain. */
  energyDrainScale: number;
  /** Multiplies the awake boredom gain. */
  boredomGainScale: number;
};

export const PERSONALITIES: Record<PersonalityPreset, PersonalityParams> = {
  curious: {
    preset: "curious",
    quirkChanceScale: 1,
    // Curious keeps today's pools exactly (they already lean on tilt/peek).
    extraQuirks: [],
    idleWeights: { idle: 1, sit: 1, look_cursor: 1 },
    walkBoredom: 75,
    wanderStepScale: 1,
    sleepEnergy: 15,
    nightSleepEnergy: 30,
    nudgeCooldownScale: 1,
    energyDrainScale: 1,
    boredomGainScale: 1,
  },
  lazy: {
    preset: "lazy",
    quirkChanceScale: 0.7,
    extraQuirks: [
      {
        key: "lazy_flop",
        steps: [
          { animation: "sit", durationMs: 700 },
          { animation: "yawn", durationMs: 700 },
        ],
        moods: ["happy", "tired", "bored", "curious"],
      },
      {
        key: "lazy_stretch",
        steps: [
          { animation: "stretch", durationMs: 800 },
          { animation: "sit", durationMs: 700 },
        ],
        moods: ["happy", "tired", "bored"],
      },
    ],
    idleWeights: { idle: 1, sit: 2, look_cursor: 0.5 },
    walkBoredom: 85,
    wanderStepScale: 0.6,
    sleepEnergy: 22,
    nightSleepEnergy: 38,
    nudgeCooldownScale: 1,
    energyDrainScale: 1.15,
    boredomGainScale: 1,
  },
  playful: {
    preset: "playful",
    quirkChanceScale: 1.4,
    extraQuirks: [
      {
        key: "playful_hop",
        steps: [
          { animation: "jump", durationMs: 380 },
          { animation: "wiggle", durationMs: 450 },
          { animation: "celebrate", durationMs: 500 },
        ],
        moods: ["happy", "bored", "curious"],
      },
      {
        key: "playful_tumble",
        steps: [
          { animation: "roll", durationMs: 550 },
          { animation: "jump", durationMs: 400 },
        ],
        moods: ["happy", "bored"],
      },
    ],
    idleWeights: { idle: 1, sit: 0.5, look_cursor: 1.5 },
    walkBoredom: 65,
    wanderStepScale: 1.3,
    sleepEnergy: 12,
    nightSleepEnergy: 25,
    nudgeCooldownScale: 1,
    energyDrainScale: 1,
    boredomGainScale: 1.15,
  },
  quiet: {
    preset: "quiet",
    quirkChanceScale: 0.5,
    extraQuirks: [
      {
        key: "quiet_settle",
        steps: [{ animation: "sit", durationMs: 900 }],
        moods: ["happy", "curious", "tired", "bored", "lonely"],
      },
      {
        key: "quiet_still",
        steps: [
          { animation: "idle", durationMs: 800 },
          { animation: "sit", durationMs: 700 },
        ],
        moods: ["happy", "curious", "bored"],
      },
    ],
    idleWeights: { idle: 2, sit: 1.5, look_cursor: 0.5 },
    walkBoredom: 80,
    wanderStepScale: 0.7,
    sleepEnergy: 15,
    nightSleepEnergy: 32,
    nudgeCooldownScale: 2,
    energyDrainScale: 1,
    boredomGainScale: 1,
  },
};

export const DEFAULT_PERSONALITY: PersonalityParams = PERSONALITIES.curious;

/** Params for a settings value; unknown/missing presets fall back to curious
 *  (same rule as the backend's normalize_personality_preset). */
export function personalityFor(preset: string | null | undefined): PersonalityParams {
  return (PERSONALITY_PRESETS as readonly string[]).includes(preset ?? "")
    ? PERSONALITIES[preset as PersonalityPreset]
    : DEFAULT_PERSONALITY;
}

/**
 * Weighted pick among the calm idle variants. With equal weights this is
 * exactly `arr[floor(r * 3)]` (same rng consumption), so curious matches the
 * historical uniform pick.
 */
export function pickIdleVariant(
  weights: PersonalityParams["idleWeights"],
  r: number,
): MovementState {
  const order: Array<["idle" | "sit" | "look_cursor", number]> = [
    ["idle", weights.idle],
    ["sit", weights.sit],
    ["look_cursor", weights.look_cursor],
  ];
  const total = order.reduce((n, [, w]) => n + w, 0);
  let x = r * total;
  for (const [anim, w] of order) {
    if (x < w) return anim;
    x -= w;
  }
  return order[order.length - 1][0];
}
