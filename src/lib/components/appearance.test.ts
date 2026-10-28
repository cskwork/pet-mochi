import { describe, expect, it } from "vitest";
import {
  accessoryPlacement,
  HEAD_ANCHORS,
  normalizeAccessory,
  normalizeSkin,
  PET_ACCESSORIES,
  petSizeFor,
  SKIN_FILTERS,
} from "./appearance";

describe("appearance tables", () => {
  it("classic skin has no filter; every other skin has one", () => {
    expect(SKIN_FILTERS.classic).toBe("none");
    for (const [k, v] of Object.entries(SKIN_FILTERS)) {
      if (k !== "classic") expect(v, k).toMatch(/sepia\(/);
    }
  });

  it("unknown values fall back like the backend normalizers", () => {
    expect(normalizeSkin("neon")).toBe("classic");
    expect(normalizeSkin(undefined)).toBe("classic");
    expect(normalizeAccessory("monocle")).toBe("none");
    expect(normalizeAccessory("crown")).toBe("crown");
  });

  it("pet size follows the scale, clamped to [0.75, 1.5]", () => {
    expect(petSizeFor(1)).toBe(140);
    expect(petSizeFor(1.5)).toBe(210);
    expect(petSizeFor(0.75)).toBe(105);
    expect(petSizeFor(9)).toBe(210);
    expect(petSizeFor(Number.NaN)).toBe(140);
  });

  it("accessories hide while asleep, rolling, hiding, or peeking", () => {
    for (const anim of ["sleep", "roll", "hide", "peek"] as const) {
      expect(accessoryPlacement("crown", anim)).toBeNull();
    }
    expect(accessoryPlacement("none", "idle")).toBeNull();
  });

  it("every visible anchor stays inside the sprite box", () => {
    for (const acc of PET_ACCESSORIES) {
      for (const anim of Object.keys(HEAD_ANCHORS) as (keyof typeof HEAD_ANCHORS)[]) {
        const p = accessoryPlacement(acc, anim);
        if (!p) continue;
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(1);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(0.5);
      }
    }
  });
});
