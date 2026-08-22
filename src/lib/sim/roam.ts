/** Axis-aligned rectangle in logical pixels (monitor work area). */
export type Rect = { x: number; y: number; width: number; height: number };

/** Bridge-shaped monitor descriptor. Rect is logical px (physical / the
 *  monitor's own scaleFactor — conversion lives in bridge/roamer.ts). */
export type MonitorInfo = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
};

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

// ===== REQ-121 — multi-monitor roaming =====

/** Per-eligible-tick crossing probability. At 1 tick / 3s this averages
 *  ≤ ~1 crossing per 10 idle minutes (200 eligible ticks → 0.005). */
export const MONITOR_CROSSING_PROBABILITY = 0.005;

/** Slack (logical px) for "x-ranges touching" — monitor edges are exact in
 *  theory but logical-space division can leave a fractional remainder. */
const EDGE_TOLERANCE_PX = 2;

export type MonitorCrossingPlan = {
  targetMonitorId: string;
  /** Edge of the TARGET monitor where the pet re-enters (opposite the edge
   *  it walked off). Exiting the current monitor's right → enters "left". */
  entryEdge: "left" | "right";
  /** Absolute (work-area-space) window position after the crossing. */
  winPosAfter: { x: number; y: number };
  /** Pet position inside the moved window after the crossing. */
  petPosAfter: { x: number; y: number };
};

/**
 * REQ-121 — occasionally plan a crossing to an adjacent monitor. Pure and
 * seeded: the caller injects `rng`, moods other than curious/bored never
 * cross, and a crossing only happens when the pet is at (or within petSize
 * of) the current monitor's left/right edge AND another monitor's x-range
 * touches that edge (within EDGE_TOLERANCE_PX) with any y-overlap and enough
 * room for the window. The plan parks the window at the target's opposite
 * edge — same y, clamped into the target's range — with the pet entering at
 * that edge. Returns null when no crossing should happen this tick.
 */
export function planMonitorCrossing(
  winPos: { x: number; y: number },
  petPos: { x: number; y: number },
  monitors: readonly MonitorInfo[],
  currentMonitorId: string,
  mood: "happy" | "curious" | "tired" | "hungry" | "bored" | "lonely",
  rng: () => number,
  viewport: { width: number; height: number },
  petSize: number,
): MonitorCrossingPlan | null {
  if (mood !== "curious" && mood !== "bored") return null;
  if (rng() >= MONITOR_CROSSING_PROBABILITY) return null;
  const current = monitors.find((m) => m.id === currentMonitorId);
  if (!current) return null;

  const petAbsX = winPos.x + petPos.x;
  const nearLeft = petAbsX - current.x <= petSize;
  const nearRight = current.x + current.width - (petAbsX + petSize) <= petSize;

  const fits = (m: MonitorInfo): boolean =>
    m.width >= viewport.width && m.height >= viewport.height;
  const yOverlap = (m: MonitorInfo): boolean =>
    m.y < current.y + current.height && m.y + m.height > current.y;

  // Left edge first (fixed, arbitrary order — a monitor narrower than 2×
  // petSize could otherwise make the choice nondeterministic per call site).
  if (nearLeft) {
    // Adjacent = x-range ending at (touching) the current left edge.
    const target = monitors.find(
      (m) => m !== current && m.id !== current.id && fits(m) &&
        Math.abs(m.x + m.width - current.x) <= EDGE_TOLERANCE_PX && yOverlap(m),
    );
    if (target) {
      // Enter the target from its RIGHT edge, heading left.
      return {
        targetMonitorId: target.id,
        entryEdge: "right",
        winPosAfter: {
          x: target.x + target.width - viewport.width,
          y: clamp(winPos.y, target.y, target.y + target.height - viewport.height),
        },
        petPosAfter: { x: viewport.width - petSize, y: petPos.y },
      };
    }
  }
  if (nearRight) {
    const target = monitors.find(
      (m) => m !== current && m.id !== current.id && fits(m) &&
        Math.abs(current.x + current.width - m.x) <= EDGE_TOLERANCE_PX && yOverlap(m),
    );
    if (target) {
      // Enter the target from its LEFT edge, heading right.
      return {
        targetMonitorId: target.id,
        entryEdge: "left",
        winPosAfter: {
          x: target.x,
          y: clamp(winPos.y, target.y, target.y + target.height - viewport.height),
        },
        petPosAfter: { x: 0, y: petPos.y },
      };
    }
  }
  return null;
}
