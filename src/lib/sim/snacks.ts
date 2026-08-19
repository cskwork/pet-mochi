import { deriveMood } from "./mood";
import { clamp, type MovementState, type PetState } from "./state";
import type { AnimationStep } from "./actions";

/**
 * Snack picker + favorite-snack discovery (PRD §27.5, REQ-107).
 *
 * Each pet has a hidden, stable favorite snack derived from its identity.
 * Feeding the favorite for the first time is a "discovery" moment that the
 * caller persists as a durable memory; later favorite feeds give a small
 * affection bonus. Pure module — no IO, no randomness.
 */

export type SnackKey = "strawberry" | "dango" | "cookie";

export const SNACK_KEYS: readonly SnackKey[] = [
  "strawberry",
  "dango",
  "cookie",
] as const;

export const SNACKS: Record<SnackKey, { icon: string; label: string }> = {
  strawberry: { icon: "🍓", label: "Strawberry" },
  dango: { icon: "🍡", label: "Dango" },
  cookie: { icon: "🍪", label: "Cookie" },
};

/** Marker the discovery memory content always contains — the restart path
 *  greps memories for this string to restore the `discovered` flag. */
export const FAVORITE_MEMORY_MARKER = "favorite snack";

export const FAVORITE_MEMORY_TYPE = "pet_belief";

/** Stable favorite for a pet. FNV-1a over identity so it survives restarts
 *  and is uniform-ish across the three snacks. */
export function favoriteSnackFor(petId: string, createdAt: string): SnackKey {
  const h = fnv1a(`${petId}|${createdAt}`);
  return SNACK_KEYS[h % SNACK_KEYS.length];
}

export type SnackFeedResult = {
  state: PetState;
  bubble: string;
  /** Same audit event type as the plain Feed action. */
  eventType: string;
  salience: number;
  steps: AnimationStep[];
  isFavorite: boolean;
  /** True exactly once — the first time the favorite is fed. */
  favoriteDiscovered: boolean;
  /** Durable memory payload to persist when `favoriteDiscovered`; else null. */
  memory: {
    type: string;
    content: string;
    importance: number;
    confidence: number;
  } | null;
};

/**
 * Feed a specific snack. Base stat effects match the plain Feed action
 * (`applyAction("feed")`); the favorite adds +2 affection and a blush beat.
 * `alreadyDiscovered` is caller-persisted state (memory row / session flag).
 */
export function applySnackFeed(
  state: PetState,
  snack: SnackKey,
  alreadyDiscovered: boolean,
): SnackFeedResult {
  const nowIso = new Date().toISOString();
  const favorite = favoriteSnackFor(state.id, state.createdAt);
  const isFavorite = snack === favorite;
  const favoriteDiscovered = isFavorite && !alreadyDiscovered;
  const steps = isFavorite ? favoriteFeedSteps() : plainFeedSteps();

  const next: PetState = {
    ...state,
    hunger: clamp(state.hunger - 35),
    affection: clamp(state.affection + (isFavorite ? 5 : 3)),
    stress: clamp(state.stress - 4),
    // Same rationale as applyAction: user attention satisfies curiosity so the
    // "?" mood mark clears on the same tap.
    curiosity: clamp(state.curiosity - 35),
    currentAnimation: steps[steps.length - 1].animation,
    lastInteractionAt: nowIso,
  };
  const settled: PetState = { ...next, mood: deriveMood(next) };

  const icon = SNACKS[snack].icon;
  const bubble = favoriteDiscovered
    ? `${state.name}: !! ${icon} MY FAVORITE ♡`
    : isFavorite
      ? `${state.name}: ${icon} favorite!! ♡`
      : `${state.name}: *nom nom* ${icon}`;

  return {
    state: settled,
    bubble,
    eventType: "USER_FED_PET",
    salience: 35,
    steps,
    isFavorite,
    favoriteDiscovered,
    memory: favoriteDiscovered
      ? {
          type: FAVORITE_MEMORY_TYPE,
          content: `${state.name}'s ${FAVORITE_MEMORY_MARKER} is ${icon} ${SNACKS[snack].label}`,
          importance: 3,
          confidence: 0.9,
        }
      : null,
  };
}

/** Restore the discovered flag from persisted memories (restart path). */
export function isFavoriteDiscoveredInMemories(
  memories: readonly { type: string; content: string }[],
): boolean {
  return memories.some(
    (m) =>
      m.type === FAVORITE_MEMORY_TYPE &&
      m.content.includes(FAVORITE_MEMORY_MARKER),
  );
}

// Mirrors actions.ts feedSteps — kept private there, and the favorite variant
// needs its own shape anyway.
function plainFeedSteps(): AnimationStep[] {
  return [
    { animation: "eat", durationMs: 380 },
    { animation: "eat_2", durationMs: 380 },
    { animation: "eat", durationMs: 380 },
    { animation: "eat_2", durationMs: 380 },
    { animation: "celebrate", durationMs: 700 },
  ];
}

function favoriteFeedSteps(): AnimationStep[] {
  return [
    { animation: "eat", durationMs: 340 },
    { animation: "eat_2", durationMs: 340 },
    { animation: "eat", durationMs: 340 },
    { animation: "eat_2", durationMs: 340 },
    { animation: "blush", durationMs: 560 },
    { animation: "celebrate", durationMs: 700 },
  ];
}

// Last-step animation type check helper for tests.
export function lastSnackAnimation(steps: AnimationStep[]): MovementState {
  return steps[steps.length - 1].animation;
}

function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h | 0);
}
