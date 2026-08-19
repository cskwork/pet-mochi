import { describe, expect, it } from "vitest";
import {
  nextQuirk,
  QUIRK_CHANCE,
  QUIRK_COOLDOWN_MS,
  QUIRK_ELIGIBLE_ANIMATIONS,
  QUIRK_POOLS,
} from "./quirks";
import { newPetState, type Mood, type PetState } from "./state";

const NOW = Date.parse("2026-08-19T12:00:00Z");

const fixedRng = (n: number) => () => n;

function pet(overrides: Partial<PetState> = {}): PetState {
  return { ...newPetState(), ...overrides };
}

describe("REQ-106 idle micro-quirks — eligibility", () => {
  it("fires from idle when rng is under the chance threshold", () => {
    const q = nextQuirk(pet({ currentAnimation: "idle" }), null, NOW, fixedRng(0));
    expect(q).not.toBeNull();
  });

  it("fires from sit and look_cursor too", () => {
    for (const anim of ["sit", "look_cursor"] as const) {
      const q = nextQuirk(pet({ currentAnimation: anim }), null, NOW, fixedRng(0));
      expect(q, anim).not.toBeNull();
    }
  });

  it("never fires while sleeping, walking, or mid-anything-else", () => {
    for (const anim of ["sleep", "walk", "run", "eat", "celebrate", "dizzy"] as const) {
      expect(QUIRK_ELIGIBLE_ANIMATIONS.has(anim)).toBe(false);
      const q = nextQuirk(pet({ currentAnimation: anim }), null, NOW, fixedRng(0));
      expect(q, anim).toBeNull();
    }
  });

  it("respects the 45s cooldown, then reopens", () => {
    const p = pet({ currentAnimation: "idle" });
    const justFired = NOW - QUIRK_COOLDOWN_MS + 1;
    expect(nextQuirk(p, justFired, NOW, fixedRng(0))).toBeNull();
    const longAgo = NOW - QUIRK_COOLDOWN_MS;
    expect(nextQuirk(p, longAgo, NOW, fixedRng(0))).not.toBeNull();
  });

  it("does not fire when rng lands at or above the chance", () => {
    const p = pet({ currentAnimation: "idle" });
    expect(nextQuirk(p, null, NOW, fixedRng(QUIRK_CHANCE))).toBeNull();
    expect(nextQuirk(p, null, NOW, fixedRng(0.99))).toBeNull();
  });
});

describe("REQ-113 intensity scaling of quirk chance", () => {
  it("chanceScale 0 disables quirks entirely", () => {
    const p = pet({ currentAnimation: "idle" });
    expect(nextQuirk(p, null, NOW, fixedRng(0), 0)).toBeNull();
  });

  it("chanceScale halves the threshold", () => {
    const p = pet({ currentAnimation: "idle" });
    // r just below half the base chance fires at scale 0.5…
    expect(
      nextQuirk(p, null, NOW, fixedRng(QUIRK_CHANCE * 0.5 - 0.001), 0.5),
    ).not.toBeNull();
    // …but r just above it doesn't.
    expect(
      nextQuirk(p, null, NOW, fixedRng(QUIRK_CHANCE * 0.5 + 0.001), 0.5),
    ).toBeNull();
  });

  it("chanceScale above 1 is clamped (never exceeds the base chance)", () => {
    const p = pet({ currentAnimation: "idle" });
    expect(nextQuirk(p, null, NOW, fixedRng(QUIRK_CHANCE + 0.001), 5)).toBeNull();
  });
});

describe("REQ-106 quirk pools", () => {
  const MOODS: Mood[] = ["happy", "curious", "tired", "hungry", "bored", "lonely"];

  it("every mood has at least one chain and picks from its own pool", () => {
    for (const mood of MOODS) {
      expect(QUIRK_POOLS[mood].length).toBeGreaterThan(0);
      const q = nextQuirk(pet({ currentAnimation: "idle", mood }), null, NOW, fixedRng(0));
      expect(q).not.toBeNull();
      expect(QUIRK_POOLS[mood].map((c) => c.key)).toContain(q!.key);
    }
  });

  it("every chain has 1–3 steps with positive durations", () => {
    for (const mood of MOODS) {
      for (const chain of QUIRK_POOLS[mood]) {
        expect(chain.steps.length).toBeGreaterThanOrEqual(1);
        expect(chain.steps.length).toBeLessThanOrEqual(3);
        for (const s of chain.steps) {
          expect(s.durationMs).toBeGreaterThan(0);
        }
      }
    }
  });

  it("is deterministic for a fixed rng", () => {
    const p = pet({ currentAnimation: "idle", mood: "happy" });
    const a = nextQuirk(p, null, NOW, fixedRng(0.1));
    const b = nextQuirk(p, null, NOW, fixedRng(0.1));
    expect(a).toEqual(b);
  });
});
