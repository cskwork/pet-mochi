export type Mood =
  | "happy"
  | "curious"
  | "tired"
  | "hungry"
  | "bored"
  | "lonely";

export type Intent =
  | "idle"
  | "explore"
  | "sleep"
  | "talk"
  | "observe"
  | "celebrate";

export type MovementState =
  // core (REQ-010)
  | "idle"
  | "walk"
  | "run"
  | "sleep"
  | "jump"
  | "sit"
  | "look_cursor"
  | "hide"
  | "celebrate"
  // existing extended set (shipped before REQ-015)
  | "eat"
  | "eat_2"
  | "yawn"
  | "roll"
  | "blush"
  // REQ-015 expressive set — adds vocabulary for behavior choreography (§9.11)
  | "stretch"
  | "peek"
  | "tilt_head"
  | "shake"
  | "nuzzle"
  | "wiggle"
  | "dizzy"
  | "surprise"
  // REQ-116 snack-specific eat frames — the tray (REQ-107) shows the snack
  // the user actually picked instead of always the dango skewer.
  | "eat_strawberry"
  | "eat_strawberry_2"
  | "eat_cookie"
  | "eat_cookie_2";

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
  /** RFC3339 timestamp of the last idle-triggered status report (PRD §9.8).
   *  Drives the 12-hour cadence gate; null until the first report runs. */
  lastReportAt: string | null;
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

/**
 * Minutes elapsed between `lastInteractionAtIso` (RFC3339, as persisted by the
 * backend) and `now`. Returns `null` when the timestamp is missing or
 * unparseable so callers can fall back to a sane default (e.g. session start).
 *
 * Extracted so the persist→restart→derive pipeline can be regression-tested
 * (PRD §21.3: `lastInteractionAt` survives restart and `awayMinutes` is
 * computed from it).
 */
export function computeAwayMinutes(
  lastInteractionAtIso: string | null | undefined,
  now: number,
): number | null {
  if (!lastInteractionAtIso) return null;
  const t = Date.parse(lastInteractionAtIso);
  if (Number.isNaN(t)) return null;
  return (now - t) / 60_000;
}

/**
 * Round all integer stat fields to whole numbers. The backend models these as
 * `i32` (see `src-tauri/src/models.rs`), so passing a fractional value to
 * `save_pet_state` would fail Tauri's serde deserialization with
 * "invalid type: floating point". The simulator keeps fractional values
 * internally so small decay rates accumulate smoothly across ticks; this
 * helper is the canonical conversion at the persistence boundary.
 */
export function roundStats(state: PetState): PetState {
  return {
    ...state,
    hunger: Math.round(state.hunger),
    energy: Math.round(state.energy),
    affection: Math.round(state.affection),
    boredom: Math.round(state.boredom),
    curiosity: Math.round(state.curiosity),
    stress: Math.round(state.stress),
    trust: Math.round(state.trust),
    relationshipLevel: Math.round(state.relationshipLevel),
  };
}

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
    lastReportAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
