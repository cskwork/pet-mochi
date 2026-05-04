import type { AnimationStep } from "./actions";
import type { Mood, PetState } from "./state";
import type { PetEvent } from "./salience";

/**
 * Behavior choreography (PRD §9.11, REQ-094..099).
 *
 * The LLM, when consulted at high-salience events, picks a *preset key* and a
 * *variant index* from this closed catalog. It never composes raw
 * MovementState sequences and never returns free text.
 *
 * Bubble tokens are restricted to {@link ClosedToken} — glyphs and short
 * pet-language onomatopoeia. Free-form human sentences are rejected by the
 * validator.
 */

export type { AnimationStep };

/** PRD §9.11 / REQ-096 closed bubble vocabulary. */
export type ClosedToken =
  // glyphs
  | "…"
  | "?"
  | "♡"
  | "!"
  // short pet-language onomatopoeia (deliberately non-words)
  | "nyu"
  | "boop"
  | "mhmm"
  | "hmf"
  | "ah"
  | "oh";

export const CLOSED_TOKENS: readonly ClosedToken[] = [
  "…",
  "?",
  "♡",
  "!",
  "nyu",
  "boop",
  "mhmm",
  "hmf",
  "ah",
  "oh",
] as const;

export type ChoreographyPreset = {
  /** Stable string key, also what the LLM returns. */
  key: ChoreographyKey;
  /** Human-readable hint for prompts and dev tools. */
  intent: string;
  /** Closed list of variants. The LLM picks an index in [0, variants.length). */
  variants: AnimationStep[][];
  /** Default bubble token when none is supplied; null = silent. */
  defaultBubble: ClosedToken | null;
};

/** PRD §9.11 / REQ-095 closed catalog of choreography keys. */
export type ChoreographyKey =
  | "greet_returning"
  | "confused_hesitate"
  | "delight_burst"
  | "curious_peek"
  | "sleepy_settle"
  | "playful_wiggle"
  | "dizzy_recover"
  | "gentle_nuzzle";

export const CHOREOGRAPHY_KEYS: readonly ChoreographyKey[] = [
  "greet_returning",
  "confused_hesitate",
  "delight_burst",
  "curious_peek",
  "sleepy_settle",
  "playful_wiggle",
  "dizzy_recover",
  "gentle_nuzzle",
] as const;

/**
 * The closed catalog. Every step's `animation` is a MovementState literal —
 * extending the union without updating this catalog is a TS compile error.
 */
export const CHOREOGRAPHY_CATALOG: Record<ChoreographyKey, ChoreographyPreset> = {
  greet_returning: {
    key: "greet_returning",
    intent: "user came back after being away",
    defaultBubble: "♡",
    variants: [
      [
        { animation: "surprise", durationMs: 380 },
        { animation: "jump",     durationMs: 420 },
        { animation: "celebrate", durationMs: 700 },
      ],
      [
        { animation: "stretch",  durationMs: 500 },
        { animation: "wiggle",   durationMs: 500 },
        { animation: "celebrate", durationMs: 700 },
      ],
      [
        { animation: "peek",     durationMs: 500 },
        { animation: "surprise", durationMs: 360 },
        { animation: "wiggle",   durationMs: 700 },
      ],
    ],
  },

  confused_hesitate: {
    key: "confused_hesitate",
    intent: "ambiguous or unfamiliar event",
    defaultBubble: "?",
    variants: [
      [
        { animation: "tilt_head", durationMs: 600 },
        { animation: "shake",     durationMs: 500 },
        { animation: "tilt_head", durationMs: 600 },
      ],
      [
        { animation: "tilt_head", durationMs: 700 },
        { animation: "peek",      durationMs: 500 },
      ],
    ],
  },

  delight_burst: {
    key: "delight_burst",
    intent: "something great just happened",
    defaultBubble: "!",
    variants: [
      [
        { animation: "surprise",  durationMs: 320 },
        { animation: "celebrate", durationMs: 600 },
        { animation: "wiggle",    durationMs: 500 },
      ],
      [
        { animation: "jump",      durationMs: 420 },
        { animation: "celebrate", durationMs: 600 },
      ],
    ],
  },

  curious_peek: {
    key: "curious_peek",
    intent: "noticed something new or unfamiliar",
    defaultBubble: "?",
    variants: [
      [
        { animation: "peek",      durationMs: 600 },
        { animation: "tilt_head", durationMs: 500 },
        { animation: "look_cursor", durationMs: 600 },
      ],
      [
        { animation: "tilt_head", durationMs: 600 },
        { animation: "peek",      durationMs: 600 },
      ],
    ],
  },

  sleepy_settle: {
    key: "sleepy_settle",
    intent: "low energy, ready to rest",
    defaultBubble: "…",
    variants: [
      [
        { animation: "yawn",  durationMs: 700 },
        { animation: "sit",   durationMs: 500 },
        { animation: "sleep", durationMs: 900 },
      ],
      [
        { animation: "stretch", durationMs: 600 },
        { animation: "yawn",    durationMs: 700 },
        { animation: "sleep",   durationMs: 900 },
      ],
    ],
  },

  playful_wiggle: {
    key: "playful_wiggle",
    intent: "wants to play, has spare energy",
    defaultBubble: "nyu",
    variants: [
      [
        { animation: "wiggle",    durationMs: 500 },
        { animation: "jump",      durationMs: 420 },
        { animation: "celebrate", durationMs: 600 },
      ],
      [
        { animation: "roll",      durationMs: 550 },
        { animation: "jump",      durationMs: 420 },
        { animation: "wiggle",    durationMs: 500 },
      ],
      [
        { animation: "wiggle",    durationMs: 500 },
        { animation: "celebrate", durationMs: 600 },
      ],
    ],
  },

  dizzy_recover: {
    key: "dizzy_recover",
    intent: "stressed or overstimulated, needs a beat to recover",
    defaultBubble: "hmf",
    variants: [
      [
        { animation: "dizzy", durationMs: 700 },
        { animation: "sit",   durationMs: 500 },
        { animation: "yawn",  durationMs: 600 },
      ],
      [
        { animation: "dizzy", durationMs: 800 },
        { animation: "shake", durationMs: 500 },
        { animation: "sit",   durationMs: 500 },
      ],
    ],
  },

  gentle_nuzzle: {
    key: "gentle_nuzzle",
    intent: "warm low-energy affection moment",
    defaultBubble: "♡",
    variants: [
      [
        { animation: "nuzzle", durationMs: 700 },
        { animation: "blush",  durationMs: 500 },
      ],
      [
        { animation: "blush",  durationMs: 500 },
        { animation: "nuzzle", durationMs: 700 },
        { animation: "sit",    durationMs: 500 },
      ],
    ],
  },
};

/** Validated choreography payload — what the LLM (or fallback) hands to the runner. */
export type ChoreographyPick = {
  preset: ChoreographyKey;
  variant: number;
  /** Optional bubble token; null/undefined renders nothing. */
  bubble: ClosedToken | null;
};

/**
 * Strict validator for the LLM's JSON reply (REQ-099).
 * Returns `null` when the payload doesn't match the closed shape — the
 * caller MUST then run {@link pickFallbackPreset}.
 *
 * Accepts:
 *   { "preset": "<one of CHOREOGRAPHY_KEYS>",
 *     "variant": <integer in range>,
 *     "bubble":  <optional, one of CLOSED_TOKENS or "" or null> }
 *
 * Rejects:
 *   - any other key shape
 *   - free-text bubble values
 *   - unknown preset keys
 *   - variant indices that are out of bounds for the picked preset
 */
export function validateChoreographyPayload(raw: unknown): ChoreographyPick | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;

  const presetVal = obj["preset"];
  if (typeof presetVal !== "string") return null;
  if (!isChoreographyKey(presetVal)) return null;
  const preset = presetVal;

  const variantVal = obj["variant"];
  if (typeof variantVal !== "number" || !Number.isInteger(variantVal)) return null;
  const variants = CHOREOGRAPHY_CATALOG[preset].variants;
  if (variantVal < 0 || variantVal >= variants.length) return null;

  let bubble: ClosedToken | null = null;
  if ("bubble" in obj) {
    const bv = obj["bubble"];
    if (bv === null || bv === undefined || bv === "") {
      bubble = null;
    } else if (typeof bv !== "string") {
      return null;
    } else if (isClosedToken(bv)) {
      bubble = bv;
    } else {
      return null;
    }
  }

  return { preset, variant: variantVal, bubble };
}

/** Resolve a {@link ChoreographyPick} into the actual ordered animation steps. */
export function stepsForPick(pick: ChoreographyPick): AnimationStep[] {
  return CHOREOGRAPHY_CATALOG[pick.preset].variants[pick.variant];
}

/** Default bubble for a preset (used when LLM omits the field). */
export function defaultBubbleFor(key: ChoreographyKey): ClosedToken | null {
  return CHOREOGRAPHY_CATALOG[key].defaultBubble;
}

/** Type-guards used by the validator and by tests. */
export function isChoreographyKey(s: string): s is ChoreographyKey {
  return (CHOREOGRAPHY_KEYS as readonly string[]).includes(s);
}

export function isClosedToken(s: string): s is ClosedToken {
  return (CLOSED_TOKENS as readonly string[]).includes(s);
}

// ===== Deterministic fallback selector — REQ-098 =====

/**
 * Pure function: pick a choreography preset for the given pet state and
 * triggering event. Used when the LLM is unavailable, slow, or returned
 * an invalid payload.
 *
 * Mapping is mood- and event-driven; the variant index is chosen by a
 * lightweight seeded hash so the same (state, event) pair plays the same
 * variant deterministically — no surprise drift, but rotates across
 * different (state, event) combinations so the pet doesn't feel canned.
 *
 * REQ-098: every (Mood × event-type) combination must yield a valid catalog
 * key. The exhaustive dispatch below guarantees that.
 */
export function pickFallbackPreset(
  state: PetState,
  event: PetEvent,
): ChoreographyPick {
  const preset = preferredPresetFor(state, event);
  const variants = CHOREOGRAPHY_CATALOG[preset].variants;
  const seed = hashString(`${preset}|${event.type}|${state.mood}|${state.relationshipLevel}`);
  const variant = seed % variants.length;
  return {
    preset,
    variant,
    bubble: defaultBubbleFor(preset),
  };
}

function preferredPresetFor(state: PetState, event: PetEvent): ChoreographyKey {
  // Event-driven first (some events have a strong intrinsic shape).
  switch (event.type) {
    case "USER_RETURNED":
      return event.awayMinutes >= 30 ? "greet_returning" : "playful_wiggle";
    case "USER_CLICKED_PET":
      return "gentle_nuzzle";
    case "USER_HOVERED_PET":
      return "curious_peek";
    case "USER_SENT_MESSAGE":
      return moodToPreset(state.mood);
    case "FILE_FOUND_IN_INBOX":
    case "FILE_INSPECTION_APPROVED":
      return "curious_peek";
    case "MEMORY_CREATED":
      return "delight_burst";
    case "STATUS_REPORT_DUE":
      return "sleepy_settle";
    case "TIME_OF_DAY_CHANGED":
      return event.period === "night" ? "sleepy_settle" : "playful_wiggle";
    case "APP_STARTED":
      return "greet_returning";
    case "APP_CLOSING":
      return "sleepy_settle";
    case "LLM_RESPONSE_READY":
    case "IDLE_TICK":
      return moodToPreset(state.mood);
  }
}

function moodToPreset(mood: Mood): ChoreographyKey {
  switch (mood) {
    case "happy":   return "delight_burst";
    case "curious": return "curious_peek";
    case "tired":   return "sleepy_settle";
    case "hungry":  return "confused_hesitate";
    case "bored":   return "playful_wiggle";
    case "lonely":  return "gentle_nuzzle";
  }
}

/** Tiny non-cryptographic hash; deterministic across runs and platforms. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h | 0);
}

// Note: every preset variant is typed as `AnimationStep[]`, and `AnimationStep`
// already constrains its `animation` field to `MovementState`. Adding the new
// REQ-015 literals to `MovementState` without listing them in the catalog is a
// permissible drift but a non-error — the validator simply won't pick them.
