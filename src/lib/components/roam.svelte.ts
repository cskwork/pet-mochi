/**
 * REQ-124.2 — roam composable extracted from Pet.svelte (pure move).
 * REQ-120/121 window/pet co-position state: work-area + monitor caches and
 * the ≤30s refresh-cadence stamps, wrapping bridge/roamer.ts. The work area
 * is logical px (what the sim speaks); the window position is kept in BOTH
 * spaces because the OS truth is physical — only step deltas cross the
 * boundary (rounded once), so repeated logical↔physical conversion can't
 * accumulate drift. Refresh rides the walk branch of the 3s tick — no new
 * timers. Window moves never focus (no focus stealing, §27.2.2).
 */
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../bridge/api";
import { getWorkArea, listMonitors, type WorkArea } from "../bridge/roamer";
import {
  advanceRoam,
  nextWanderDelta,
  planMonitorCrossing,
  type MonitorInfo,
  type Mood,
} from "../sim";

const ROAM_REFRESH_MS = 30_000;

export type RoamCache = {
  workArea: WorkArea;
  /** REQ-121 — all named monitors (logical px) + the current one's id. */
  monitors: MonitorInfo[];
  currentMonitorId: string | null;
  winPosPhysical: { x: number; y: number };
  winPosLogical: { x: number; y: number };
};

/** Pet-owned channels the roam path must drive: the shared scale-factor
 *  cache (also used by drag landing + hit-testing) and the post-crossing
 *  pet-position/animation continuation. */
export type RoamHooks = {
  onScaleFactor: (sf: number) => void;
  onCrossingLanded: (petPos: { x: number; y: number }) => void;
};

/** One edge-walking attempt's outcome. "shift" — the window moved and the
 *  caller should adopt petPos + step (facing follows the step's x sign);
 *  "crossing" — a monitor crossing was scheduled here, the async landing
 *  flows through onCrossingLanded, and the caller sets facing from
 *  entryEdge. Null — fall back to the classic in-window wander. */
export type RoamStepResult =
  | {
      type: "shift";
      petPos: { x: number; y: number };
      step: { x: number; y: number };
    }
  | { type: "crossing"; entryEdge: "left" | "right" };

export function createRoam(hooks: RoamHooks) {
  let roamCache: RoamCache | null = null;
  let roamRefreshedAt = 0;

  /** REQ-120 — refresh the cache when null or older than 30s; rides the
   *  walk branch of the 3s tick (no new timers). */
  function maybeRefresh(now: number): void {
    if (roamCache && now - roamRefreshedAt < ROAM_REFRESH_MS) return;
    roamRefreshedAt = now;
    void refresh();
  }

  async function refresh(): Promise<void> {
    if (!api.hasBackend) return;
    const [area, monitors, winPhys] = await Promise.all([
      getWorkArea(),
      listMonitors(),
      getCurrentWindow().outerPosition().catch(() => null),
    ]);
    if (!area || !monitors || !winPhys) {
      roamCache = null;
      return;
    }
    hooks.onScaleFactor(area.scaleFactor);
    roamCache = {
      workArea: area,
      monitors,
      currentMonitorId: area.id,
      winPosPhysical: { x: winPhys.x, y: winPhys.y },
      winPosLogical: {
        x: winPhys.x / area.scaleFactor,
        y: winPhys.y / area.scaleFactor,
      },
    };
  }

  /** Drop the cache so the next walk tick re-reads it (e.g. after an OS
   *  drag moved the window behind our back). */
  function invalidate(): void {
    roamCache = null;
    roamRefreshedAt = 0;
  }

  /**
   * REQ-120 — one edge-walking attempt for this tick. The caller falls back
   * to the classic in-window wander on null (interior step, no cache yet, or
   * a work-area clamp — which is exactly the pre-REQ-120 behavior).
   * REQ-121 — the crossing is evaluated FIRST so it wins whenever both a
   *  crossing and an edge shift could apply.
   */
  function tryStep(args: {
    now: number;
    mood: Mood;
    petPos: { x: number; y: number };
    viewport: { width: number; height: number };
    petSize: number;
  }): RoamStepResult | null {
    if (!api.hasBackend) return null;
    maybeRefresh(args.now);
    const cache = roamCache;
    if (!cache) return null;
    const entryEdge = tryMonitorCrossing(
      cache,
      args.mood,
      args.petPos,
      args.viewport,
      args.petSize,
    );
    if (entryEdge) return { type: "crossing", entryEdge };
    const step = nextWanderDelta();
    const roam = advanceRoam(
      cache.winPosLogical,
      args.petPos,
      step,
      cache.workArea,
      args.viewport,
      args.petSize,
    );
    if (!roam) return null;
    const shifted =
      roam.winPos.x !== cache.winPosLogical.x || roam.winPos.y !== cache.winPosLogical.y;
    if (!shifted) return null; // work-area clamp — the classic path clamps too
    applyWindowShift(step.x, step.y);
    return { type: "shift", petPos: roam.petPos, step };
  }

  /** REQ-120 — fire-and-forget window shift; window moves never focus. */
  function applyWindowShift(dxLogical: number, dyLogical: number): void {
    const cache = roamCache;
    if (!cache) return;
    const dx = Math.round(dxLogical * cache.workArea.scaleFactor);
    const dy = Math.round(dyLogical * cache.workArea.scaleFactor);
    const phys = { x: cache.winPosPhysical.x + dx, y: cache.winPosPhysical.y + dy };
    roamCache = {
      ...cache,
      winPosPhysical: phys,
      winPosLogical: {
        x: cache.winPosLogical.x + dxLogical,
        y: cache.winPosLogical.y + dyLogical,
      },
    };
    getCurrentWindow()
      .setPosition(new PhysicalPosition(phys.x, phys.y))
      .catch(() => undefined);
  }

  /**
   * REQ-121 — occasionally walk off the monitor edge onto the adjacent one.
   * The pure planner owns gating (mood, seeded probability, edge + adjacency);
   * this applies the plan fire-and-forget and NEVER focuses the window. The
   * physical target is computed through the TARGET monitor's scaleFactor
   * (per-monitor conversion, per the spec); the cache refresh that follows
   * the move re-anchors on the new current monitor. Returns the entry edge
   * the caller should face, or null when no crossing was planned.
   */
  function tryMonitorCrossing(
    cache: RoamCache,
    mood: Mood,
    petPos: { x: number; y: number },
    viewport: { width: number; height: number },
    petSize: number,
  ): "left" | "right" | null {
    if (!cache.currentMonitorId) return null;
    const plan = planMonitorCrossing(
      cache.winPosLogical,
      petPos,
      cache.monitors,
      cache.currentMonitorId,
      mood,
      Math.random,
      viewport,
      petSize,
    );
    if (!plan) return null;
    const target = cache.monitors.find((m) => m.id === plan.targetMonitorId);
    const sf = target?.scaleFactor ?? cache.workArea.scaleFactor;
    const phys = {
      x: Math.round(plan.winPosAfter.x * sf),
      y: Math.round(plan.winPosAfter.y * sf),
    };
    // Optimistic cache update; the refresh after the move is authoritative.
    roamCache = {
      ...cache,
      winPosPhysical: phys,
      winPosLogical: plan.winPosAfter,
    };
    getCurrentWindow()
      .setPosition(new PhysicalPosition(phys.x, phys.y))
      .then(() => {
        hooks.onCrossingLanded(plan.petPosAfter);
        invalidate();
        void refresh();
      })
      .catch((err) => {
        // REQ-121 — hot-unplug: re-enumerate once and abort silently. The pet
        // keeps her pre-crossing position (never applied on failure).
        console.warn("monitor crossing failed", err);
        invalidate();
        void refresh();
      });
    return plan.entryEdge;
  }

  return { tryStep, invalidate, refresh };
}
