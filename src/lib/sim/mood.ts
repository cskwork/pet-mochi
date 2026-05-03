import type { Mood, PetState } from "./state";

/**
 * Derive the visible mood from hidden stats. Order matters: the first matching
 * predicate wins. Tuned to PRD §15.3.
 */
export function deriveMood(state: PetState): Mood {
  if (state.energy < 20) return "tired";
  if (state.hunger > 75) return "hungry";
  if (state.boredom > 70) return "bored";
  if (state.affection < 20) return "lonely";
  if (state.curiosity > 70) return "curious";
  if (state.stress > 65) return "focused";
  return "happy";
}
