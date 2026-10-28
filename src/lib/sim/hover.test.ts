import { describe, expect, it } from "vitest";
import { HOVER_COOLDOWN_MS, hoverReaction } from "./hover";
import { PERSONALITIES } from "./personality";
import { newPetState } from "./state";

const NOW = 1_000_000;

describe("hover reaction", () => {
  it("plays a tiny 1–2 step reaction from a calm pose", () => {
    const steps = hoverReaction({ ...newPetState(), currentAnimation: "idle" }, null, NOW, () => 0);
    expect(steps).not.toBeNull();
    expect(steps!.length).toBeGreaterThanOrEqual(1);
    expect(steps!.length).toBeLessThanOrEqual(2);
  });

  it("never wakes a sleeping pet or interrupts other poses", () => {
    for (const anim of ["sleep", "eat", "celebrate", "surprise", "dizzy"] as const) {
      expect(hoverReaction({ ...newPetState(), currentAnimation: anim }, null, NOW, () => 0)).toBeNull();
    }
  });

  it("respects the ~20s cooldown", () => {
    const p = { ...newPetState(), currentAnimation: "idle" as const };
    expect(hoverReaction(p, NOW - HOVER_COOLDOWN_MS + 1, NOW, () => 0)).toBeNull();
    expect(hoverReaction(p, NOW - HOVER_COOLDOWN_MS, NOW, () => 0)).not.toBeNull();
  });

  it("mood picks the first option; personality flavors the rest", () => {
    const happy = { ...newPetState(), mood: "happy" as const, currentAnimation: "idle" as const };
    expect(hoverReaction(happy, null, NOW, () => 0)![0].animation).toBe("blush");
    const playful = hoverReaction(happy, null, NOW, () => 0.99, PERSONALITIES.playful)!;
    expect(playful[0].animation).toBe("celebrate");
    const quiet = hoverReaction(happy, null, NOW, () => 0.99, PERSONALITIES.quiet)!;
    expect(quiet[0].animation).toBe("blush");
  });
});
