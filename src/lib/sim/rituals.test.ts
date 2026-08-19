import { describe, expect, it } from "vitest";
import { ritualForTransition, type Period } from "./rituals";

describe("REQ-111 time-of-day rituals", () => {
  it("first observation of the session plays nothing", () => {
    expect(ritualForTransition(null, "morning", "idle")).toBeNull();
  });

  it("no transition → no ritual", () => {
    const periods: Period[] = ["morning", "afternoon", "evening", "night"];
    for (const p of periods) {
      expect(ritualForTransition(p, p, "idle")).toBeNull();
    }
  });

  it("morning transition stretches awake with a greeting", () => {
    const r = ritualForTransition("night", "morning", "sleep")!;
    expect(r.period).toBe("morning");
    expect(r.steps.map((s) => s.animation)).toEqual(["stretch", "wiggle"]);
    expect(r.bubble).not.toBeNull();
  });

  it("evening transition winds down silently", () => {
    const r = ritualForTransition("afternoon", "evening", "idle")!;
    expect(r.steps.map((s) => s.animation)).toEqual(["yawn", "stretch", "sit"]);
    expect(r.bubble).toBeNull();
  });

  it("night transition settles into sleep", () => {
    const r = ritualForTransition("evening", "night", "idle")!;
    expect(r.steps[r.steps.length - 1].animation).toBe("sleep");
  });

  it("night transition is skipped when already asleep", () => {
    expect(ritualForTransition("evening", "night", "sleep")).toBeNull();
  });

  it("afternoon has no ritual by design", () => {
    expect(ritualForTransition("morning", "afternoon", "idle")).toBeNull();
  });

  it("all steps have positive durations", () => {
    for (const [prev, next] of [
      ["night", "morning"],
      ["afternoon", "evening"],
      ["evening", "night"],
    ] as const) {
      const r = ritualForTransition(prev, next, "idle");
      for (const s of r?.steps ?? []) {
        expect(s.durationMs).toBeGreaterThan(0);
      }
    }
  });
});
