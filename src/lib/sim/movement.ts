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
  if (state.boredom > 75) return "walk";
  if (state.mood === "happy" && ctx.recentPositiveEvent) return "celebrate";
  if (state.stress > 80) return "hide";
  return pick(IDLE_VARIANTS, rng);
}

/**
 * Pick the next position delta when the pet decides to wander. Bounded inside
 * the given window dimensions.
 */
export function nextWanderPosition(
  current: { x: number; y: number },
  bounds: { width: number; height: number; petSize: number },
  rng: Rng = defaultRng,
): { x: number; y: number } {
  const stepX = Math.round((rng() - 0.5) * 80);
  const stepY = Math.round((rng() - 0.5) * 40);
  const maxX = Math.max(0, bounds.width - bounds.petSize);
  const maxY = Math.max(0, bounds.height - bounds.petSize);
  const x = Math.min(maxX, Math.max(0, current.x + stepX));
  const y = Math.min(maxY, Math.max(0, current.y + stepY));
  return { x, y };
}
