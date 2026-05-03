import { clamp, type Mood, type PetState } from "./state";

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

export type ActionResult = {
  state: PetState;
  bubble: string;
  eventType: string;
  salience: number;
};

/**
 * Apply a tamagotchi-style interaction to the pet's state. Pure: returns a
 * brand-new PetState without mutating the input. The animation it sets is a
 * one-shot — the next simulation tick will re-derive based on stats.
 */
export function applyAction(state: PetState, key: ActionKey): ActionResult {
  const nowIso = new Date().toISOString();
  const def = ACTION_DEFINITIONS[key];

  switch (key) {
    case "feed": {
      const next: PetState = {
        ...state,
        hunger:    clamp(state.hunger    - 35),
        affection: clamp(state.affection + 3),
        stress:    clamp(state.stress    - 4),
        currentAnimation: "celebrate",
        lastInteractionAt: nowIso,
      };
      return { state: next, bubble: `${state.name}: nom nom! 🍡`, eventType: def.eventType, salience: def.salience };
    }
    case "play": {
      const next: PetState = {
        ...state,
        boredom:   clamp(state.boredom   - 30),
        energy:    clamp(state.energy    - 8),
        affection: clamp(state.affection + 4),
        stress:    clamp(state.stress    - 6),
        currentAnimation: "jump",
        lastInteractionAt: nowIso,
      };
      return { state: next, bubble: `${state.name}: wheee! 🎾`, eventType: def.eventType, salience: def.salience };
    }
    case "rest": {
      const next: PetState = {
        ...state,
        energy: clamp(state.energy + 25),
        stress: clamp(state.stress - 12),
        currentAnimation: "sleep",
        lastInteractionAt: nowIso,
      };
      return { state: next, bubble: `${state.name}: zzz… 💤`, eventType: def.eventType, salience: def.salience };
    }
    case "pet": {
      const next: PetState = {
        ...state,
        affection: clamp(state.affection + 1),
        boredom:   clamp(state.boredom   - 4),
        stress:    clamp(state.stress    - 2),
        currentAnimation: "jump",
        lastInteractionAt: nowIso,
      };
      return { state: next, bubble: petReactionFor(state.mood, state.name), eventType: def.eventType, salience: def.salience };
    }
  }
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
