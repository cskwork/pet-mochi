export type Mood =
  | "happy"
  | "curious"
  | "tired"
  | "hungry"
  | "bored"
  | "lonely"
  | "focused";

export type Intent =
  | "idle"
  | "explore"
  | "sleep"
  | "talk"
  | "observe"
  | "celebrate";

export type MovementState =
  | "idle"
  | "walk"
  | "run"
  | "sleep"
  | "jump"
  | "sit"
  | "look_cursor"
  | "hide"
  | "celebrate";

export type PetState = {
  id: string;
  name: string;
  mood: Mood;
  hunger: number;
  energy: number;
  affection: number;
  boredom: number;
  curiosity: number;
  stress: number;
  trust: number;
  relationshipLevel: number;
  currentAnimation: MovementState;
  currentIntent: Intent;
  lastInteractionAt: string | null;
  lastLLMCallAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeContext = {
  cursorNearPet: boolean;
  userJustReturned: boolean;
  recentPositiveEvent: boolean;
  awayMinutes: number;
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
};

export const STAT_KEYS = [
  "hunger",
  "energy",
  "affection",
  "boredom",
  "curiosity",
  "stress",
  "trust",
] as const;

export type StatKey = (typeof STAT_KEYS)[number];

export const clamp = (n: number, lo = 0, hi = 100): number =>
  Math.min(hi, Math.max(lo, n));

export function newPetState(name = "Mochi"): PetState {
  const now = new Date().toISOString();
  return {
    id: "default",
    name,
    mood: "happy",
    hunger: 30,
    energy: 80,
    affection: 50,
    boredom: 20,
    curiosity: 60,
    stress: 10,
    trust: 50,
    relationshipLevel: 1,
    currentAnimation: "idle",
    currentIntent: "idle",
    lastInteractionAt: null,
    lastLLMCallAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
