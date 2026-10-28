import { DEFAULT_PERSONALITY, type PersonalityParams } from "./personality";
import { clamp, type PetState } from "./state";

/** Awake hunger gain per second (was 0.10 — hungry 6 min after a feed). */
export const HUNGER_PER_SEC = 0.019;
/** Awake energy drain per second (was 0.08 — tired 8 min after waking). */
export const ENERGY_DRAIN_PER_SEC = 0.011;
/** Awake boredom gain per second (was 0.10 — bored 5 min after a play). */
export const BOREDOM_PER_SEC = 0.032;

/**
 * Decay/recover a pet's hidden stats by the elapsed time. Pure function — returns
 * a new state. Decay rates are tuned for ~1-tick-per-3-seconds simulation; deltas
 * scale linearly with seconds elapsed so longer ticks behave reasonably.
 */
export function applyDecay(
  state: PetState,
  elapsedSeconds: number,
  personality: PersonalityParams = DEFAULT_PERSONALITY,
): PetState {
  if (elapsedSeconds <= 0) return state;

  // Per-second deltas, "medium" needs pacing (BACKLOG #25). Each need is
  // timed from the moment the user answers it — i.e. the action taken right
  // when the mood flips:
  //   hungry  (hunger > 75):  fed at 76 → 41; (75 − 41) / HUNGER_PER_SEC ≈ 30 min
  //   tired   (energy < 20):  wakes at WAKE_ENERGY 60; 40 / ENERGY_DRAIN ≈ 60 min
  //   bored   (boredom > 70): played at 71 → 41; 29 / BOREDOM_PER_SEC ≈ 15 min
  // Sleep recovery (+0.5/s) is unchanged. Personality multipliers scale these.
  const dHunger = HUNGER_PER_SEC * elapsedSeconds;
  const asleep = state.currentAnimation === "sleep";
  const dEnergy = asleep
    ? +0.5 * elapsedSeconds
    : -ENERGY_DRAIN_PER_SEC * personality.energyDrainScale * elapsedSeconds;
  // Boredom is frozen while asleep — otherwise it climbs past the night-sleep
  // gate (boredom < 60) and breaks her sleep from the inside.
  const dBoredom = asleep
    ? 0
    : BOREDOM_PER_SEC * personality.boredomGainScale * elapsedSeconds;
  // Curiosity drifts toward a low baseline so the "?" mark eventually clears
  // when nothing novel happens. Above 60 it gently fades; below it slowly
  // builds back up — without this, curiosity ratchets upward forever and
  // mood pins to "curious" past 70 indefinitely.
  const dCuriosity = state.curiosity > 60
    ? -0.06 * elapsedSeconds
    :  0.04 * elapsedSeconds;
  const dStress = -0.03 * elapsedSeconds;

  // Loneliness — affection drops slightly when no recent interaction.
  const lastInteraction = state.lastInteractionAt
    ? new Date(state.lastInteractionAt).getTime()
    : 0;
  const minutesSince = lastInteraction
    ? (Date.now() - lastInteraction) / 60_000
    : Infinity;
  const dAffection = minutesSince > 30 ? -0.05 * elapsedSeconds : 0;

  // Bond loosening — relationshipLevel drifts down across days of neglect, not
  // minutes. Tuned so 24h of zero interaction sheds ~2 points; a 60s tick
  // changes it by ~0.0014, well below visible-rounding so within-session feel
  // is untouched. Same 30-min idle gate as affection so casual use doesn't
  // even start the slow drift.
  const dRelationship = minutesSince > 30
    ? -(2 / 86_400) * elapsedSeconds
    : 0;

  return {
    ...state,
    hunger: clamp(state.hunger + dHunger),
    energy: clamp(state.energy + dEnergy),
    boredom: clamp(state.boredom + dBoredom),
    curiosity: clamp(state.curiosity + dCuriosity),
    stress: clamp(state.stress + dStress),
    affection: clamp(state.affection + dAffection),
    relationshipLevel: clamp(state.relationshipLevel + dRelationship),
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
