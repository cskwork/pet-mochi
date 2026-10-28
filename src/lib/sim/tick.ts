import { applyDecay } from "./decay";
import { deriveMood } from "./mood";
import { chooseMovement } from "./movement";
import { DEFAULT_PERSONALITY, type PersonalityParams } from "./personality";
import type { PetState, RuntimeContext } from "./state";

/**
 * Upper bound on the seconds a single tick may apply. After OS sleep the first
 * tick would otherwise apply the whole gap at once (8h → hunger 100, energy 0)
 * while an app restart applies none; capping keeps both paths consistent with
 * the "never guilt, always joy" welcome-back design.
 */
export const MAX_TICK_ELAPSED_SECONDS = 60;

/**
 * Run one simulation tick: decay stats, derive mood, pick a new animation.
 * Pure — returns a new state.
 */
export function runTick(
  state: PetState,
  ctx: RuntimeContext,
  elapsedSeconds: number,
  personality: PersonalityParams = DEFAULT_PERSONALITY,
): PetState {
  const decayed = applyDecay(
    state,
    Math.min(elapsedSeconds, MAX_TICK_ELAPSED_SECONDS),
    personality,
  );
  const mood = deriveMood(decayed);
  const movement = chooseMovement({ ...decayed, mood }, ctx, undefined, personality);
  return {
    ...decayed,
    mood,
    currentAnimation: movement,
    currentIntent:
      movement === "sleep"
        ? "sleep"
        : movement === "celebrate"
        ? "celebrate"
        : movement === "look_cursor"
        ? "observe"
        : movement === "walk" || movement === "run"
        ? "explore"
        : "idle",
  };
}

export function deriveTimeOfDay(d = new Date()): RuntimeContext["timeOfDay"] {
  const h = d.getHours();
  if (h < 6) return "night";
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  if (h < 22) return "evening";
  return "night";
}
