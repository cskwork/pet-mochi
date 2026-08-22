import { describe, expect, it } from "vitest";
import { advanceRoam } from "./roam";
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
