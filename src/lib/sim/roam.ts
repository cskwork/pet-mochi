/** Axis-aligned rectangle in logical pixels (monitor work area). */
export type Rect = { x: number; y: number; width: number; height: number };

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * REQ-120 — decide one screen-edge walking step. All inputs/outputs are in
 * LOGICAL pixels; physical↔logical conversion happens once at the bridge
 * boundary (bridge/roamer.ts), never here.
 *
 * `intendedStep` is the UN-clamped wander delta (see nextWanderDelta). Cases:
 *
 * - Interior step (pet + step stays inside the viewport) → `null`; the
 *   existing in-window wander path already handles it.
 * - The step would clamp at a viewport edge AND the window can shift by the
 *   same delta while staying inside `workArea` → shifted `winPos` and the
 *   pet's UNCHANGED in-window `petPos`. Geometry: the pet's absolute position
 *   is `winPos + petPos`, so shifting the window by the delta while the pet
 *   keeps its in-window slot advances the pet's absolute position by the full
 *   un-clamped delta — it walks across the desktop, sprite fully visible,
 *   with no snap-back on the next tick.
 * - The work-area edge blocks the shift (in either axis — shifts are
 *   all-or-nothing) → clamped `petPos` with the window unmoved: exactly the
 *   pre-REQ-120 clamp behavior.
 */
export function advanceRoam(
  winPos: { x: number; y: number },
  petPos: { x: number; y: number },
  intendedStep: { x: number; y: number },
  workArea: Rect,
  viewport: { width: number; height: number },
  petSize: number,
): { winPos: { x: number; y: number }; petPos: { x: number; y: number } } | null {
  const maxX = viewport.width - petSize;
  const maxY = viewport.height - petSize;
  const targetX = petPos.x + intendedStep.x;
  const targetY = petPos.y + intendedStep.y;
  const clampedPetX = clamp(targetX, 0, maxX);
  const clampedPetY = clamp(targetY, 0, maxY);
  if (clampedPetX === targetX && clampedPetY === targetY) return null;

  // The window rectangle must stay inside the work area.
  const winMaxX = workArea.x + workArea.width - viewport.width;
  const winMaxY = workArea.y + workArea.height - viewport.height;
  const winTargetX = winPos.x + intendedStep.x;
  const winTargetY = winPos.y + intendedStep.y;
  if (
    winTargetX >= workArea.x && winTargetX <= winMaxX &&
    winTargetY >= workArea.y && winTargetY <= winMaxY
  ) {
    return {
      winPos: { x: winTargetX, y: winTargetY },
      petPos: { x: petPos.x, y: petPos.y },
    };
  }
  return {
    winPos: { x: winPos.x, y: winPos.y },
    petPos: { x: clampedPetX, y: clampedPetY },
  };
}
