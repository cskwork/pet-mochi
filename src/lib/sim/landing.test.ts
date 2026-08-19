import { describe, expect, it } from "vitest";
import { BIG_DROP_PX, GRAB_ANIMATION, landingSteps } from "./landing";

describe("REQ-112 drag landing", () => {
  it("the grab pose is the surprise sprite", () => {
    expect(GRAB_ANIMATION).toBe("surprise");
  });

  it("small drops settle straight back to idle", () => {
    const steps = landingSteps(BIG_DROP_PX - 1);
    expect(steps.map((s) => s.animation)).toEqual(["idle"]);
  });

  it("big drops wobble through dizzy → shake before settling", () => {
    const steps = landingSteps(BIG_DROP_PX);
    expect(steps.map((s) => s.animation)).toEqual(["dizzy", "shake", "idle"]);
  });

  it("every step has a positive duration and the resting pose is idle", () => {
    for (const distance of [0, 50, BIG_DROP_PX, 2000]) {
      const steps = landingSteps(distance);
      expect(steps.length).toBeGreaterThan(0);
      expect(steps[steps.length - 1].animation).toBe("idle");
      for (const s of steps) {
        expect(s.durationMs).toBeGreaterThan(0);
      }
    }
  });
});
