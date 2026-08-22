import type { MovementState, PetState, RuntimeContext } from "./state";

const IDLE_VARIANTS: MovementState[] = ["idle", "sit", "look_cursor"];

export type Rng = () => number;

const defaultRng: Rng = Math.random;

function pick<T>(arr: T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

/**
 * Choose the next movement state. Pure function, deterministic when an `rng` is
 * provided. Reflects PRD §15.2.
 */
export function chooseMovement(
  state: PetState,
  ctx: RuntimeContext,
  rng: Rng = defaultRng,
): MovementState {
  if (state.energy < 15) return "sleep";
  if (ctx.userJustReturned) return "run";
  if (ctx.cursorNearPet) return "look_cursor";
  // REQ-119 — at night a tired but unhurried pet curls up instead of pacing:
  // the sleep gate widens from energy < 15 to energy < 30 while boredom
  // stays below 60. Daytime behavior is unchanged.
  if (ctx.timeOfDay === "night" && state.energy < 30 && state.boredom < 60) {
    return "sleep";
  }
  if (state.boredom > 75) return "walk";
  if (state.mood === "happy" && ctx.recentPositiveEvent) return "celebrate";
  return pick(IDLE_VARIANTS, rng);
}

/** A no-go rectangle that the pet should not be drawn over. */
export type Obstacle = { left: number; top: number; right: number; bottom: number };

function rectsOverlap(
  ax: number, ay: number, aw: number, ah: number,
  obs: Obstacle,
): boolean {
  return (
    ax < obs.right &&
    ax + aw > obs.left &&
    ay < obs.bottom &&
    ay + ah > obs.top
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * One raw, UN-clamped wander delta (logical px): x ∈ [-40, 40], y ∈ [-20, 20].
 * REQ-120 — extracted so the roam path can hand the un-clamped step to
 * `advanceRoam` while `nextWanderPosition` keeps consuming it below.
 */
export function nextWanderDelta(rng: Rng = defaultRng): { x: number; y: number } {
  return { x: Math.round((rng() - 0.5) * 80), y: Math.round((rng() - 0.5) * 40) };
}

/**
 * Pick the next position delta when the pet decides to wander. Bounded inside
 * the given window dimensions. When `obstacles` is provided, refuses positions
 * that would overlap any obstacle rect — retries up to a few times and, on
 * failure, returns the current position so the pet stops rather than warping.
 *
 * Backwards compatible: callers can omit `obstacles` (or pass `undefined`) and
 * the wander stays free.
 */
export function nextWanderPosition(
  current: { x: number; y: number },
  bounds: { width: number; height: number; petSize: number },
  obstacles?: readonly Obstacle[],
  rng: Rng = defaultRng,
): { x: number; y: number } {
  const maxX = Math.max(0, bounds.width - bounds.petSize);
  const maxY = Math.max(0, bounds.height - bounds.petSize);
  const obs = obstacles ?? [];

  const overlapsAny = (x: number, y: number): boolean =>
    obs.some((o) => rectsOverlap(x, y, bounds.petSize, bounds.petSize, o));

  // First try natural random steps (the usual wander feel).
  for (let i = 0; i < 6; i++) {
    const step = nextWanderDelta(rng);
    const x = clamp(current.x + step.x, 0, maxX);
    const y = clamp(current.y + step.y, 0, maxY);
    if (!overlapsAny(x, y)) return { x, y };
  }

  // All random steps overlap an obstacle (likely the pet is currently inside
  // one — e.g. the status panel just opened). Escape to a known-safe cell
  // computed from the same obstacle set.
  return findSafeStartPosition(bounds, obs);
}

/**
 * Find a sensible starting position for the pet that avoids all obstacles.
 * Tries vertical-center first; if that overlaps, scans a small grid.
 */
export function findSafeStartPosition(
  bounds: { width: number; height: number; petSize: number },
  obstacles: readonly Obstacle[] = [],
): { x: number; y: number } {
  const maxX = Math.max(0, bounds.width - bounds.petSize);
  const maxY = Math.max(0, bounds.height - bounds.petSize);
  const overlapsAny = (x: number, y: number): boolean =>
    obstacles.some((o) => rectsOverlap(x, y, bounds.petSize, bounds.petSize, o));

  const center = {
    x: clamp(Math.round((bounds.width  - bounds.petSize) / 2), 0, maxX),
    y: clamp(Math.round((bounds.height - bounds.petSize) / 2), 0, maxY),
  };
  if (!overlapsAny(center.x, center.y)) return center;

  // Scan a 5x5 grid for a non-overlapping cell.
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const x = clamp(Math.round((c / 4) * maxX), 0, maxX);
      const y = clamp(Math.round((r / 4) * maxY), 0, maxY);
      if (!overlapsAny(x, y)) return { x, y };
    }
  }
  // No safe cell — return center anyway.
  return center;
}
