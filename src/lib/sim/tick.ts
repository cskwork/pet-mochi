import { applyDecay } from "./decay";
import { deriveMood } from "./mood";
import { chooseMovement } from "./movement";
import type { PetState, RuntimeContext } from "./state";

/**
 * Run one simulation tick: decay stats, derive mood, pick a new animation.
 * Pure — returns a new state.
 */
export function runTick(
  state: PetState,
  ctx: RuntimeContext,
  elapsedSeconds: number,
): PetState {
  const decayed = applyDecay(state, elapsedSeconds);
  const mood = deriveMood(decayed);
  const movement = chooseMovement({ ...decayed, mood }, ctx);
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
