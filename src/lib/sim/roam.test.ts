import { describe, expect, it } from "vitest";
import {
  advanceRoam,
  MONITOR_CROSSING_PROBABILITY,
  planMonitorCrossing,
  type MonitorInfo,
} from "./roam";
import { nextWanderDelta } from "./movement";

// Logical-unit fixtures: a 1920×1080 work area, a 360×360 viewport, and a
// 140px pet (Pet.svelte defaults) → maxX = maxY = 220.
const WORK_AREA = { x: 0, y: 0, width: 1920, height: 1080 };
const VIEWPORT = { width: 360, height: 360 };
const PET_SIZE = 140;

describe("REQ-120 nextWanderDelta — raw un-clamped step", () => {
  it("stays within the same ±40/±20 envelope nextWanderPosition draws from", () => {
    let seed = 7;
    const rng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 200; i++) {
      const d = nextWanderDelta(rng);
      expect(d.x).toBeGreaterThanOrEqual(-40);
      expect(d.x).toBeLessThanOrEqual(40);
      expect(d.y).toBeGreaterThanOrEqual(-20);
      expect(d.y).toBeLessThanOrEqual(20);
      expect(Number.isInteger(d.x)).toBe(true);
      expect(Number.isInteger(d.y)).toBe(true);
    }
  });
});

describe("REQ-120 advanceRoam — screen-edge walking", () => {
  it("returns null for an interior step (existing wander path handles it)", () => {
    expect(
      advanceRoam(
        { x: 100, y: 100 },
        { x: 100, y: 100 },
        { x: 20, y: 10 },
        WORK_AREA,
        VIEWPORT,
        PET_SIZE,
      ),
    ).toBeNull();
  });

  it("shifts the window at the right viewport edge when the work area has room", () => {
    // Pet at x=200 stepping +40 would clamp at 220. Window at x=100 can shift
    // +40 inside the work area → the window follows and the pet KEEPS its
    // in-window position: its absolute position advances by the full
    // un-clamped +40 without the sprite ever clipping past the window edge.
    const out = advanceRoam(
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 40, y: 0 },
      WORK_AREA,
      VIEWPORT,
      PET_SIZE,
    );
    expect(out).toEqual({ winPos: { x: 140, y: 100 }, petPos: { x: 200, y: 100 } });
  });

  it("shifts the window at the bottom viewport edge (y axis)", () => {
    const out = advanceRoam(
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 0, y: 30 },
      WORK_AREA,
      VIEWPORT,
      PET_SIZE,
    );
    expect(out).toEqual({ winPos: { x: 100, y: 130 }, petPos: { x: 100, y: 200 } });
  });

  it("clamps when the window is already flush with the work-area edge (corner)", () => {
    // Window occupies x∈[1560, 1920] — no room right. Today's behavior: the
    // pet clamps at 220 inside the unmoved window.
    const out = advanceRoam(
      { x: 1560, y: 720 },
      { x: 200, y: 100 },
      { x: 40, y: 0 },
      WORK_AREA,
      VIEWPORT,
      PET_SIZE,
    );
    expect(out).toEqual({ winPos: { x: 1560, y: 720 }, petPos: { x: 220, y: 100 } });
  });

  it("clamps when the delta exceeds the remaining work-area room", () => {
    // Work area 560 wide → winMaxX = 200; window at 180 has only 20px of
    // room but the step needs 60 → the shift is blocked, the pet clamps.
    const area = { x: 0, y: 0, width: 560, height: 1080 };
    const out = advanceRoam(
      { x: 180, y: 100 },
      { x: 200, y: 100 },
      { x: 60, y: 0 }, // needs win → 240 > 200: only 20 of room
      area,
      VIEWPORT,
      PET_SIZE,
    );
    expect(out).toEqual({ winPos: { x: 180, y: 100 }, petPos: { x: 220, y: 100 } });
  });

  it("shifts on negative x deltas (walking off the left edge)", () => {
    const out = advanceRoam(
      { x: 100, y: 100 },
      { x: 20, y: 100 },
      { x: -40, y: 0 },
      WORK_AREA,
      VIEWPORT,
      PET_SIZE,
    );
    expect(out).toEqual({ winPos: { x: 60, y: 100 }, petPos: { x: 20, y: 100 } });
  });

  it("clamps on negative deltas when the work-area left edge blocks the shift", () => {
    const out = advanceRoam(
      { x: 20, y: 100 }, // only 20px of room to the left
      { x: 10, y: 100 },
      { x: -40, y: 0 },
      WORK_AREA,
      VIEWPORT,
      PET_SIZE,
    );
    expect(out).toEqual({ winPos: { x: 20, y: 100 }, petPos: { x: 0, y: 100 } });
  });

  it("clamps on negative y deltas when the work-area top blocks the shift", () => {
    const out = advanceRoam(
      { x: 100, y: 10 },
      { x: 100, y: 5 },
      { x: 0, y: -30 },
      WORK_AREA,
      VIEWPORT,
      PET_SIZE,
    );
    expect(out).toEqual({ winPos: { x: 100, y: 10 }, petPos: { x: 100, y: 0 } });
  });

  it("all-or-nothing: a shift blocked in one axis clamps both", () => {
    // x could shift, but y is flush with the work-area bottom → the pet keeps
    // today's fully-clamped step instead of a half-shifted window.
    const out = advanceRoam(
      { x: 100, y: 720 }, // winMaxY = 1080-360 = 720: no room down
      { x: 200, y: 200 },
      { x: 40, y: 30 },
      WORK_AREA,
      VIEWPORT,
      PET_SIZE,
    );
    expect(out).toEqual({ winPos: { x: 100, y: 720 }, petPos: { x: 220, y: 220 } });
  });
});

describe("REQ-121 planMonitorCrossing — multi-monitor roaming", () => {
  const M1: MonitorInfo = {
    id: "m1", x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1,
  };
  const M2: MonitorInfo = {
    id: "m2", x: 1920, y: 0, width: 1920, height: 1080, scaleFactor: 1,
  };
  const MONITORS = [M1, M2];
  const passRng = () => 0; // 0 < probability → crossing may proceed
  const failRng = () => 0.999;

  it("exports the ≤1-per-10-idle-minutes probability (1 tick / 3s)", () => {
    expect(MONITOR_CROSSING_PROBABILITY).toBe(0.005);
  });

  it("returns null when no monitor is adjacent to the current edge", () => {
    // Pet flush with m1's right edge, but m2 is 100px away → no crossing.
    const out = planMonitorCrossing(
      { x: 1560, y: 100 },
      { x: 220, y: 60 },
      [M1, { ...M2, x: 2020 }],
      "m1",
      "curious",
      passRng,
      VIEWPORT,
      PET_SIZE,
    );
    expect(out).toBeNull();
  });

  it("returns null for moods other than curious/bored", () => {
    for (const mood of ["happy", "tired", "hungry", "lonely"] as const) {
      expect(
        planMonitorCrossing(
          { x: 1560, y: 100 },
          { x: 220, y: 60 },
          MONITORS,
          "m1",
          mood,
          passRng,
          VIEWPORT,
          PET_SIZE,
        ),
      ).toBeNull();
    }
  });

  it("crosses right: exits m1's right edge, re-enters m2 from its left edge", () => {
    const out = planMonitorCrossing(
      { x: 1560, y: 100 },
      { x: 220, y: 60 },
      MONITORS,
      "m1",
      "bored",
      passRng,
      VIEWPORT,
      PET_SIZE,
    );
    expect(out).toEqual({
      targetMonitorId: "m2",
      entryEdge: "left",
      winPosAfter: { x: 1920, y: 100 },
      petPosAfter: { x: 0, y: 60 },
    });
  });

  it("crosses left: exits m2's left edge, re-enters m1 from its right edge", () => {
    const out = planMonitorCrossing(
      { x: 1920, y: 100 },
      { x: 0, y: 60 },
      MONITORS,
      "m2",
      "curious",
      passRng,
      VIEWPORT,
      PET_SIZE,
    );
    expect(out).toEqual({
      targetMonitorId: "m1",
      entryEdge: "right",
      winPosAfter: { x: 1560, y: 100 },
      petPosAfter: { x: 220, y: 60 },
    });
  });

  it("treats x-ranges touching within a small tolerance as adjacent", () => {
    // 1px gap between m1's right edge and m2's left edge — still a crossing.
    const out = planMonitorCrossing(
      { x: 1560, y: 100 },
      { x: 220, y: 60 },
      [M1, { ...M2, x: 1921 }],
      "m1",
      "curious",
      passRng,
      VIEWPORT,
      PET_SIZE,
    );
    expect(out?.targetMonitorId).toBe("m2");
  });

  it("clamps the window's y into the target monitor's range", () => {
    // Target sits 200px lower; a window at y=50 must clamp to the target's
    // top edge (200).
    const lower = { ...M2, y: 200 };
    const out = planMonitorCrossing(
      { x: 1560, y: 50 },
      { x: 220, y: 60 },
      [M1, lower],
      "m1",
      "curious",
      passRng,
      VIEWPORT,
      PET_SIZE,
    );
    expect(out?.winPosAfter).toEqual({ x: 1920, y: 200 });
  });

  it("requires y-overlap between the monitors", () => {
    const far = { ...M2, y: 1200 }; // below m1 entirely
    const out = planMonitorCrossing(
      { x: 1560, y: 100 },
      { x: 220, y: 60 },
      [M1, far],
      "m1",
      "curious",
      passRng,
      VIEWPORT,
      PET_SIZE,
    );
    expect(out).toBeNull();
  });

  it("skips adjacent monitors too small to fit the window", () => {
    const tiny = { ...M2, width: 200, height: 200 };
    const out = planMonitorCrossing(
      { x: 1560, y: 100 },
      { x: 220, y: 60 },
      [M1, tiny],
      "m1",
      "curious",
      passRng,
      VIEWPORT,
      PET_SIZE,
    );
    expect(out).toBeNull();
  });

  it("probability gate: rng 0.999 never crosses, rng 0 does", () => {
    const args = [
      { x: 1560, y: 100 },
      { x: 220, y: 60 },
      MONITORS,
      "m1",
      "curious",
    ] as const;
    expect(planMonitorCrossing(...args, failRng, VIEWPORT, PET_SIZE)).toBeNull();
    expect(planMonitorCrossing(...args, passRng, VIEWPORT, PET_SIZE)).not.toBeNull();
  });

  it("returns null when the pet is not near a monitor edge", () => {
    // Window mid-monitor; pet at the window's right edge is nowhere near
    // m1's right edge (1560 + 220 + 140 = 1920? window x=760: petAbs right
    // = 760+220+140 = 1120, 800px short of the edge).
    const out = planMonitorCrossing(
      { x: 760, y: 100 },
      { x: 220, y: 60 },
      MONITORS,
      "m1",
      "curious",
      passRng,
      VIEWPORT,
      PET_SIZE,
    );
    expect(out).toBeNull();
  });
});
