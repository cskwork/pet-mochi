import type { AnimationStep } from "./actions";
import type { MovementState, RuntimeContext } from "./state";

/**
 * Time-of-day rituals (PRD §27.6, REQ-111).
 *
 * The tick loop detects period transitions and plays a short deterministic
 * ritual. Pure: the caller tracks the previous period and decides whether the
 * pet is unhurried enough to play it.
 */

export type Period = RuntimeContext["timeOfDay"];

export type Ritual = {
  period: Period;
  steps: AnimationStep[];
  bubble: string | null;
};

/**
 * Ritual for a period transition, or null when nothing should play:
 * - first observation of the session (`prev === null`) — the wake-up beat
 *   already covers session start;
 * - no actual change;
 * - afternoon (no ritual by design);
 * - night while already asleep.
 */
export function ritualForTransition(
  prev: Period | null,
  next: Period,
  currentAnimation: MovementState,
): Ritual | null {
  if (prev === null || prev === next) return null;

  switch (next) {
    case "morning":
      return {
        period: next,
        steps: [
          { animation: "stretch", durationMs: 700 },
          { animation: "wiggle", durationMs: 500 },
        ],
        bubble: "morning! ☀",
      };
    case "evening":
      return {
        period: next,
        steps: [
          { animation: "yawn", durationMs: 600 },
          { animation: "stretch", durationMs: 500 },
          { animation: "sit", durationMs: 500 },
        ],
        bubble: null,
      };
    case "night":
      if (currentAnimation === "sleep") return null;
      return {
        period: next,
        steps: [
          { animation: "yawn", durationMs: 500 },
          { animation: "sit", durationMs: 400 },
          { animation: "sleep", durationMs: 900 },
        ],
        bubble: "…zzz",
      };
    case "afternoon":
      return null;
  }
}
