import { deriveMood } from "./mood";
import { clamp, type Mood, type MovementState, type PetState } from "./state";

export type ActionKey = "feed" | "play" | "rest" | "pet";

export const ACTION_KEYS: readonly ActionKey[] = ["feed", "play", "rest", "pet"] as const;

export type ActionDefinition = {
  label: string;
  icon: string;
  /** Backend event_type for the audit log. */
  eventType: string;
  /** 0–100 salience score routed through the in-process bus. */
  salience: number;
};

export const ACTION_DEFINITIONS: Record<ActionKey, ActionDefinition> = {
  feed: { label: "Feed", icon: "🍡", eventType: "USER_FED_PET",          salience: 35 },
  play: { label: "Play", icon: "🎾", eventType: "USER_PLAYED_WITH_PET",   salience: 40 },
  pet:  { label: "Pat",  icon: "✋", eventType: "USER_CLICKED_PET",       salience: 20 },
  rest: { label: "Rest", icon: "💤", eventType: "USER_PUT_PET_TO_REST",   salience: 25 },
};

/** A single beat in a multi-frame action animation. The pet plays them in
 *  order; the LAST step doubles as the resting pose until the next sim tick. */
export type AnimationStep = {
  animation: MovementState;
  durationMs: number;
};

export type ActionResult = {
  state: PetState;
  bubble: string;
  eventType: string;
  salience: number;
  /** Ordered animation beats. `state.currentAnimation` always equals the last
   *  step's animation so a sim tick that fires mid-sequence settles correctly. */
  steps: AnimationStep[];
};

type Rng = () => number;
const defaultRng: Rng = Math.random;

/**
 * Apply a tamagotchi-style interaction. Pure: returns a brand-new PetState
 * along with an animation sequence. Each action plays a multi-frame sequence
 * that the UI scheduler walks through in real time.
 *
 * `rng` is exposed for deterministic play-variant picking in tests; defaults
 * to Math.random.
 */
export function applyAction(
  state: PetState,
  key: ActionKey,
  rng: Rng = defaultRng,
): ActionResult {
  const nowIso = new Date().toISOString();
  const def = ACTION_DEFINITIONS[key];

  switch (key) {
    case "feed": {
      const steps = feedSteps();
      const next: PetState = {
        ...state,
        hunger:    clamp(state.hunger    - 35),
        affection: clamp(state.affection + 3),
        stress:    clamp(state.stress    - 4),
        // Any user attention satisfies curiosity — drop well below the
        // 70-point mood threshold so mood drops out of "curious" the
        // same tap (the recompute below) and stays out for a while.
        curiosity: clamp(state.curiosity - 35),
        currentAnimation: lastAnim(steps),
        lastInteractionAt: nowIso,
      };
      return finishedAction(next, `${state.name}: *nom nom* 🍡`, def, steps);
    }
    case "play": {
      const steps = playSteps(rng);
      const next: PetState = {
        ...state,
        boredom:   clamp(state.boredom   - 30),
        energy:    clamp(state.energy    - 8),
        affection: clamp(state.affection + 4),
        stress:    clamp(state.stress    - 6),
        // Any user attention satisfies curiosity — drop well below the
        // 70-point mood threshold so mood drops out of "curious" the
        // same tap (the recompute below) and stays out for a while.
        curiosity: clamp(state.curiosity - 35),
        currentAnimation: lastAnim(steps),
        lastInteractionAt: nowIso,
      };
      return finishedAction(next, playBubble(state.name, rng), def, steps);
    }
    case "rest": {
      const steps = restSteps();
      const next: PetState = {
        ...state,
        energy: clamp(state.energy + 25),
        stress: clamp(state.stress - 12),
        // Any user attention satisfies curiosity — drop well below the
        // 70-point mood threshold so mood drops out of "curious" the
        // same tap (the recompute below) and stays out for a while.
        curiosity: clamp(state.curiosity - 35),
        currentAnimation: lastAnim(steps),
        lastInteractionAt: nowIso,
      };
      return finishedAction(next, `${state.name}: *yawn* …zzz 💤`, def, steps);
    }
    case "pet": {
      const steps = petSteps(state.currentAnimation);
      const next: PetState = {
        ...state,
        affection: clamp(state.affection + 1),
        boredom:   clamp(state.boredom   - 4),
        stress:    clamp(state.stress    - 2),
        // Any user attention satisfies curiosity — drop well below the
        // 70-point mood threshold so mood drops out of "curious" the
        // same tap (the recompute below) and stays out for a while.
        curiosity: clamp(state.curiosity - 35),
        currentAnimation: lastAnim(steps),
        lastInteractionAt: nowIso,
      };
      return finishedAction(next, petReactionFor(state.mood, state.name), def, steps);
    }
  }
}

/**
 * Recompute mood from the post-action state so visible mood overlays (e.g.
 * the "?" curious mark) clear in the same tap, instead of waiting for the
 * next 3-second sim tick to call deriveMood.
 */
function finishedAction(
  next: PetState,
  bubble: string,
  def: ActionDefinition,
  steps: AnimationStep[],
): ActionResult {
  const state: PetState = { ...next, mood: deriveMood(next) };
  return { state, bubble, eventType: def.eventType, salience: def.salience, steps };
}

function lastAnim(steps: AnimationStep[]): MovementState {
  return steps[steps.length - 1].animation;
}

// Feed: two-frame chew cycle then a satisfied celebrate. Durations are tuned
// so the whole sequence reads as one "meal" without dragging past the next
// 3-second sim tick.
function feedSteps(): AnimationStep[] {
  return [
    { animation: "eat",       durationMs: 380 },
    { animation: "eat_2",     durationMs: 380 },
    { animation: "eat",       durationMs: 380 },
    { animation: "eat_2",     durationMs: 380 },
    { animation: "celebrate", durationMs: 700 },
  ];
}

// Play has three random variants so repeated taps don't look identical.
function playSteps(rng: Rng): AnimationStep[] {
  const r = rng();
  if (r < 1 / 3) {
    // Bounce: chase + leap + chase + cheer.
    return [
      { animation: "run",       durationMs: 400 },
      { animation: "jump",      durationMs: 420 },
      { animation: "run",       durationMs: 400 },
      { animation: "celebrate", durationMs: 600 },
    ];
  }
  if (r < 2 / 3) {
    // Roll: tumble sideways then pop up cheering.
    return [
      { animation: "roll",      durationMs: 550 },
      { animation: "roll",      durationMs: 550 },
      { animation: "jump",      durationMs: 400 },
      { animation: "celebrate", durationMs: 600 },
    ];
  }
  // Wiggle: little dance — hop, cheer, hop, cheer.
  return [
    { animation: "jump",      durationMs: 380 },
    { animation: "celebrate", durationMs: 500 },
    { animation: "jump",      durationMs: 380 },
    { animation: "celebrate", durationMs: 600 },
  ];
}

function playBubble(name: string, rng: Rng): string {
  const pool = [
    `${name}: wheee! 🎾`,
    `${name}: rolly polly!`,
    `${name}: again, again!`,
  ];
  const idx = Math.min(pool.length - 1, Math.max(0, Math.floor(rng() * pool.length)));
  return pool[idx];
}

// Rest: yawn → sit → settle into sleep. Sleep is the resting pose the tick
// system can keep playing if energy stays low.
function restSteps(): AnimationStep[] {
  return [
    { animation: "yawn",  durationMs: 700 },
    { animation: "sit",   durationMs: 500 },
    { animation: "sleep", durationMs: 900 },
  ];
}

// Pat: a brief blush moment then back to a happy celebrate so the pet's
// reaction reads even when stats are otherwise neutral. When the pet is
// asleep, a quick yawn precedes the blush so the wake-up reads naturally
// instead of snapping straight to a celebrate pose.
function petSteps(prior: MovementState): AnimationStep[] {
  const base: AnimationStep[] = [
    { animation: "blush",     durationMs: 520 },
    { animation: "celebrate", durationMs: 500 },
  ];
  if (prior === "sleep") {
    return [{ animation: "yawn", durationMs: 420 }, ...base];
  }
  return base;
}

/**
 * Mood-aware short reaction string for the "pet" (pat) action.
 * Kept out of `applyAction` so it stays trivially testable in isolation.
 */
export function petReactionFor(mood: Mood, name: string): string {
  switch (mood) {
    case "tired":   return `${name}: *sleepy nuzzle*`;
    case "hungry":  return `${name}: *wants a snack*`;
    case "bored":   return `${name}: yes! play!`;
    case "lonely":  return `${name}: ♥ thank you`;
    default:        return `${name}: ✿ hi`;
  }
}
