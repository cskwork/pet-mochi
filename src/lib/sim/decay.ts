import { clamp, type PetState } from "./state";

/**
 * Decay/recover a pet's hidden stats by the elapsed time. Pure function — returns
 * a new state. Decay rates are tuned for ~1-tick-per-3-seconds simulation; deltas
 * scale linearly with seconds elapsed so longer ticks behave reasonably.
 */
export function applyDecay(state: PetState, elapsedSeconds: number): PetState {
  if (elapsedSeconds <= 0) return state;

  // Per-second deltas (very small).
  const dHunger = 0.05 * elapsedSeconds;
  const dEnergy = state.currentAnimation === "sleep" ? +0.4 * elapsedSeconds : -0.04 * elapsedSeconds;
  const dBoredom = 0.07 * elapsedSeconds;
  const dCuriosity = 0.02 * elapsedSeconds;
  const dStress = -0.01 * elapsedSeconds;

  // Loneliness — affection drops slightly when no recent interaction.
  const lastInteraction = state.lastInteractionAt
    ? new Date(state.lastInteractionAt).getTime()
    : 0;
  const minutesSince = lastInteraction
    ? (Date.now() - lastInteraction) / 60_000
    : Infinity;
  const dAffection = minutesSince > 30 ? -0.02 * elapsedSeconds : 0;

  return {
    ...state,
    hunger: clamp(state.hunger + dHunger),
    energy: clamp(state.energy + dEnergy),
    boredom: clamp(state.boredom + dBoredom),
    curiosity: clamp(state.curiosity + dCuriosity),
    stress: clamp(state.stress + dStress),
    affection: clamp(state.affection + dAffection),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Apply a single user interaction's effects (click, pet, chat).
 */
export function applyInteraction(
  state: PetState,
  kind: "click" | "hover" | "chat" | "feed" | "play" | "ignore",
): PetState {
  const base: PetState = { ...state, lastInteractionAt: new Date().toISOString() };
  switch (kind) {
    case "click":
      return {
        ...base,
        affection: clamp(state.affection + 1),
        boredom: clamp(state.boredom - 4),
        curiosity: clamp(state.curiosity + 2),
      };
    case "hover":
      return {
        ...base,
        curiosity: clamp(state.curiosity + 1),
      };
    case "chat":
      return {
        ...base,
        affection: clamp(state.affection + 2),
        boredom: clamp(state.boredom - 6),
        stress: clamp(state.stress - 2),
      };
    case "feed":
      return {
        ...base,
        hunger: clamp(state.hunger - 25),
        affection: clamp(state.affection + 3),
      };
    case "play":
      return {
        ...base,
        boredom: clamp(state.boredom - 20),
        energy: clamp(state.energy - 5),
        affection: clamp(state.affection + 2),
      };
    case "ignore":
      return {
        ...base,
        affection: clamp(state.affection - 1),
        boredom: clamp(state.boredom + 4),
      };
  }
}
