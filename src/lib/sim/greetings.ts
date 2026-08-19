import { CHOREOGRAPHY_CATALOG } from "./choreography";
import type { AnimationStep } from "./actions";
import type { ParticleKind } from "./particles";

/**
 * Tiered welcome-back ritual (PRD §27.5, REQ-108).
 *
 * The greeting is deterministic and instant — it never waits for the LLM.
 * Design rule (research finding #2): celebrate the return, never guilt the
 * absence. The bubble pools below are the *only* allowed copy; the test suite
 * enforces the no-guilt constraint over them.
 */

export type GreetingTier = "warm" | "delight" | "longing";

export type Greeting = {
  tier: GreetingTier;
  steps: AnimationStep[];
  bubble: string;
  /** Optional particle burst to play alongside. */
  burst: ParticleKind | null;
};

/** Tier boundaries in minutes of absence. */
export const GREETING_TIER_MINUTES = {
  /** Below this: no greeting (not "returned" yet — matches USER_RETURNED). */
  WARM_MIN: 30,
  DELIGHT_MIN: 120,
  LONGING_MIN: 480,
} as const;

export const GREETING_BUBBLES: Record<GreetingTier, readonly string[]> = {
  warm: ["you're back! ♡", "*happy wiggle*", "hi hi!"],
  delight: ["missed you ♡", "!! you're here!", "*zooms over*"],
  longing: [
    "you came back. I guarded the corner ♡",
    "*big stretch* …you're here!",
    "best part of my day ♡",
  ],
};

export function greetingForReturn(
  awayMinutes: number,
  rng: () => number = Math.random,
): Greeting | null {
  if (awayMinutes < GREETING_TIER_MINUTES.WARM_MIN) return null;

  const tier: GreetingTier =
    awayMinutes >= GREETING_TIER_MINUTES.LONGING_MIN
      ? "longing"
      : awayMinutes >= GREETING_TIER_MINUTES.DELIGHT_MIN
        ? "delight"
        : "warm";

  const pool = GREETING_BUBBLES[tier];
  const bubble = pool[boundedIndex(rng(), pool.length)];

  switch (tier) {
    case "warm": {
      const variants = CHOREOGRAPHY_CATALOG.greet_returning.variants;
      return {
        tier,
        steps: variants[boundedIndex(rng(), variants.length)],
        bubble,
        burst: null,
      };
    }
    case "delight": {
      const variants = CHOREOGRAPHY_CATALOG.delight_burst.variants;
      return {
        tier,
        steps: variants[boundedIndex(rng(), variants.length)],
        bubble,
        burst: "hearts",
      };
    }
    case "longing":
      // Sleepy peek → startled joy → celebration → nuzzle. Fixed sequence so
      // the longest absences always get the fullest welcome.
      return {
        tier,
        steps: [
          { animation: "peek", durationMs: 600 },
          { animation: "surprise", durationMs: 360 },
          { animation: "celebrate", durationMs: 700 },
          { animation: "nuzzle", durationMs: 600 },
        ],
        bubble,
        burst: "hearts_big",
      };
  }
}

function boundedIndex(r: number, len: number): number {
  return Math.min(len - 1, Math.max(0, Math.floor(r * len)));
}
