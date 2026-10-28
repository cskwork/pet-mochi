import { describe, expect, it } from "vitest";
import { anchorForResize, clampIntoView, type Obstacle } from "./movement";

// Overlay geometry as Pet.svelte computes it: closed status chip top-left,
// 340×76 actions panel bottom-right with an 8px margin.
function panels(width: number, height: number): Obstacle[] {
  return [
    { left: 8, top: 8, right: 108, bottom: 40 },
    { left: width - 348, top: height - 84, right: width - 8, bottom: height - 8 },
  ];
}

describe("pet size change keeps her feet anchored", () => {
  it("grow 1.0× → 1.5× with the window growing 70px, then shrink back", () => {
    const start = { x: 110, y: 110 }; // 140px pet, feet at y=250
    const grown = clampIntoView(
      anchorForResize(start, 140, 210, 70),
      { width: 360, height: 430, petSize: 210 },
      panels(360, 430),
    );
    expect(grown).toEqual({ x: 75, y: 110 });
    // Same on-screen feet: window moved up 70, so in-window feet = 320 - 70.
    expect(grown.y + 210 - 70).toBe(start.y + 140);

    const shrunk = clampIntoView(
      anchorForResize(grown, 210, 140, -70),
      { width: 360, height: 360, petSize: 140 },
      panels(360, 360),
    );
    expect(shrunk).toEqual(start);
  });

  it("is never thrown to (0,0) when placed against the size just set", () => {
    // QA race: the resize event arrived late. Placing against the NEW
    // viewport (not the stale 360px one) keeps her clear of both panels.
    for (const y of [60, 100, 136]) {
      const p = clampIntoView(
        anchorForResize({ x: 110, y }, 140, 210, 70),
        { width: 360, height: 430, petSize: 210 },
        panels(360, 430),
      );
      expect(p).not.toEqual({ x: 0, y: 0 });
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y + 210).toBeLessThanOrEqual(430 - 84);
    }
  });
});

describe("clampIntoView", () => {
  it("leaves a clear position untouched", () => {
    expect(clampIntoView({ x: 50, y: 60 }, { width: 360, height: 360, petSize: 140 }, panels(360, 360))).toEqual({
      x: 50,
      y: 60,
    });
  });

  it("slides the smallest vertical distance off a panel instead of jumping", () => {
    // Feet dip 20px into the actions panel → nudged up to sit on top of it.
    const p = clampIntoView({ x: 100, y: 156 }, { width: 360, height: 360, petSize: 140 }, panels(360, 360));
    expect(p).toEqual({ x: 100, y: 276 - 140 });
  });

  it("clamps into the viewport first", () => {
    const p = clampIntoView({ x: -30, y: 500 }, { width: 360, height: 600, petSize: 140 }, []);
    expect(p).toEqual({ x: 0, y: 460 });
  });
});
