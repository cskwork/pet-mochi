import type { MovementState, PetState } from "./state";

export type NudgeKind = "hungry" | "lonely" | "stressed" | "tired" | "bored";

export const NUDGE_KINDS: readonly NudgeKind[] = [
  "hungry",
  "lonely",
  "stressed",
  "tired",
  "bored",
] as const;

export type NudgeResult = {
  kind: NudgeKind;
  bubble: string;
  /** Optional one-shot animation hint to play with the bubble. */
  animation?: MovementState;
};

export type NudgeState = {
  /** Wall-clock (ms) of the last firing per kind. */
  lastByKind: Partial<Record<NudgeKind, number>>;
  /** Wall-clock (ms) of the last firing across all kinds. */
  lastAny: number | null;
};

export function newNudgeState(): NudgeState {
  return { lastByKind: {}, lastAny: null };
}

/**
 * Per-kind cooldown: same nudge cannot repeat inside this window. 5 min keeps
 * "I'm hungry" from spamming once the user has noticed but not acted yet.
 */
const PER_KIND_COOLDOWN_MS = 5 * 60_000;

/**
 * Global cooldown across all kinds: prevents two different nudges from firing
 * within the same window. Tuned tighter than per-kind so a fresh urgent state
 * (e.g. just-hungry right after a "lonely" nudge) is not muted for too long.
 */
const ANY_KIND_COOLDOWN_MS = 90_000;

type Trigger = {
  kind: NudgeKind;
  fires: (s: PetState) => boolean;
  /** Optional small animation cue to accompany the bubble. */
  animation?: MovementState;
};

// Order = priority. The first trigger whose predicate is true wins.
const TRIGGERS: Trigger[] = [
  { kind: "hungry",   fires: (s) => s.hunger    > 80, animation: "look_cursor" },
  { kind: "lonely",   fires: (s) => s.affection < 20, animation: "sit"         },
  { kind: "stressed", fires: (s) => s.stress    > 70, animation: "hide"        },
  { kind: "tired",    fires: (s) => s.energy    < 20, animation: "sit"         },
  { kind: "bored",    fires: (s) => s.boredom   > 75, animation: "jump"        },
];

const BUBBLES: Record<NudgeKind, readonly string[]> = {
  hungry:   ["*tummy rumble*", "snack? 🥺", "fooood..."],
  lonely:   ["where'd you go?", "♥?", "missed you"],
  stressed: ["*tail twitch*", "ugh...", "everything feels loud"],
  tired:    ["*yawn*", "...zzz", "sleepy..."],
  bored:    ["play?", "I'm wiggly", "anything fun?"],
};

/**
 * Decide whether the pet should spontaneously nudge the user this tick.
 * Pure: callers persist `NudgeState` themselves.
 *
 * `now` is wall-clock ms (`Date.now()`) so cooldowns survive across ticks.
 * `rng` defaults to Math.random; tests inject a deterministic stub.
 */
export function nextNudge(
  state: PetState,
  nudgeState: NudgeState,
  now: number,
  rng: () => number = Math.random,
): NudgeResult | null {
  // Global cooldown gates EVERY kind — including the same kind, which is
  // additionally bounded by the per-kind window.
  if (nudgeState.lastAny !== null && now - nudgeState.lastAny < ANY_KIND_COOLDOWN_MS) {
    return null;
  }

  for (const t of TRIGGERS) {
    if (!t.fires(state)) continue;
    const last = nudgeState.lastByKind[t.kind];
    if (last !== undefined && now - last < PER_KIND_COOLDOWN_MS) continue;
    const pool = BUBBLES[t.kind];
    const idx = Math.min(pool.length - 1, Math.max(0, Math.floor(rng() * pool.length)));
    return { kind: t.kind, bubble: pool[idx], animation: t.animation };
  }
  return null;
}

/** Helper for callers: stamp a result into the nudge state. Pure. */
export function rememberNudge(
  s: NudgeState,
  result: NudgeResult,
  now: number,
): NudgeState {
  return {
    lastAny: now,
    lastByKind: { ...s.lastByKind, [result.kind]: now },
  };
}
