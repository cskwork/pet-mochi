import { describe, it, expect } from "vitest";
import { newPetState } from "./state";
import {
  ACTION_KEYS,
  ACTION_DEFINITIONS,
  applyAction,
  type ActionKey,
} from "./actions";

const ALL_KEYS: ActionKey[] = ["feed", "play", "rest", "pet"];

// Deterministic stub so play-variant picking is reproducible in tests.
const fixedRng = (n: number) => () => n;

describe("ACTION_KEYS", () => {
  it("exposes exactly the four tamagotchi-style actions", () => {
    expect(new Set(ACTION_KEYS)).toEqual(new Set(ALL_KEYS));
  });

  it("has a definition entry for every key", () => {
    for (const k of ACTION_KEYS) {
      const def = ACTION_DEFINITIONS[k];
      expect(def).toBeDefined();
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.eventType.length).toBeGreaterThan(0);
      // Salience must be within the salience bus's expected 0-100 range so we
      // don't silently over-trigger the autonomous LLM gate.
      expect(def.salience).toBeGreaterThanOrEqual(0);
      expect(def.salience).toBeLessThanOrEqual(100);
    }
  });
});

describe("applyAction(feed)", () => {
  it("reduces hunger and slightly boosts affection", () => {
    const start = { ...newPetState(), hunger: 80, affection: 50, stress: 30 };
    const { state } = applyAction(start, "feed");
    expect(state.hunger).toBeLessThan(start.hunger);
    expect(state.affection).toBeGreaterThan(start.affection);
    expect(state.stress).toBeLessThanOrEqual(start.stress);
    // Final resting pose after the eating sequence is the satisfied/celebrate one.
    expect(state.currentAnimation).toBe("celebrate");
  });

  it("plays a multi-frame eating sequence ending on celebrate", () => {
    const { steps, state } = applyAction(newPetState(), "feed");
    expect(steps.length).toBeGreaterThanOrEqual(3);
    const animations = steps.map((s) => s.animation);
    // Must include both eat frames so the user actually sees chewing.
    expect(animations).toContain("eat");
    expect(animations).toContain("eat_2");
    // Last step is the resting pose and must equal state.currentAnimation.
    expect(animations[animations.length - 1]).toBe(state.currentAnimation);
    // Each step must be a positive duration so the scheduler can hold it.
    for (const step of steps) {
      expect(step.durationMs).toBeGreaterThan(0);
    }
  });

  it("never drives hunger below 0", () => {
    const start = { ...newPetState(), hunger: 5 };
    const { state } = applyAction(start, "feed");
    expect(state.hunger).toBeGreaterThanOrEqual(0);
  });

  it("never drives affection above 100", () => {
    const start = { ...newPetState(), affection: 99 };
    const { state } = applyAction(start, "feed");
    expect(state.affection).toBeLessThanOrEqual(100);
  });
});

describe("applyAction(play)", () => {
  it("reduces boredom, costs energy, raises affection", () => {
    const start = { ...newPetState(), boredom: 70, energy: 60, affection: 40 };
    const { state } = applyAction(start, "play");
    expect(state.boredom).toBeLessThan(start.boredom);
    expect(state.energy).toBeLessThan(start.energy);
    expect(state.affection).toBeGreaterThan(start.affection);
    // Multi-step play always finishes on a celebrate pose so the user sees joy.
    expect(state.currentAnimation).toBe("celebrate");
  });

  it("rng=0 picks the bounce variant including run+jump", () => {
    const { steps } = applyAction(newPetState(), "play", fixedRng(0));
    const animations = steps.map((s) => s.animation);
    expect(animations).toContain("run");
    expect(animations).toContain("jump");
  });

  it("rng=0.5 picks the roll variant including roll", () => {
    const { steps } = applyAction(newPetState(), "play", fixedRng(0.5));
    const animations = steps.map((s) => s.animation);
    expect(animations).toContain("roll");
  });

  it("rng=0.99 picks the wiggle variant", () => {
    const { steps } = applyAction(newPetState(), "play", fixedRng(0.99));
    const animations = steps.map((s) => s.animation);
    // Wiggle variant centers on jump+celebrate without run.
    expect(animations.filter((a) => a === "jump").length).toBeGreaterThanOrEqual(1);
    expect(animations).not.toContain("run");
  });

  it("clamps energy at 0 even when starting near empty", () => {
    const start = { ...newPetState(), energy: 3 };
    const { state } = applyAction(start, "play");
    expect(state.energy).toBeGreaterThanOrEqual(0);
  });

  it("clamps boredom at 0", () => {
    const start = { ...newPetState(), boredom: 5 };
    const { state } = applyAction(start, "play");
    expect(state.boredom).toBeGreaterThanOrEqual(0);
  });
});

describe("applyAction(rest)", () => {
  it("restores energy and lowers stress", () => {
    const start = { ...newPetState(), energy: 30, stress: 70 };
    const { state } = applyAction(start, "rest");
    expect(state.energy).toBeGreaterThan(start.energy);
    expect(state.stress).toBeLessThan(start.stress);
    expect(state.currentAnimation).toBe("sleep");
  });

  it("plays yawn → sit → sleep so the wind-down is visible", () => {
    const { steps, state } = applyAction(newPetState(), "rest");
    const animations = steps.map((s) => s.animation);
    expect(animations[0]).toBe("yawn");
    expect(animations).toContain("sit");
    expect(animations[animations.length - 1]).toBe("sleep");
    expect(state.currentAnimation).toBe("sleep");
  });

  it("clamps energy at 100 even when already high", () => {
    const start = { ...newPetState(), energy: 95 };
    const { state } = applyAction(start, "rest");
    expect(state.energy).toBeLessThanOrEqual(100);
  });

  it("does not change hunger", () => {
    const start = { ...newPetState(), hunger: 50 };
    const { state } = applyAction(start, "rest");
    expect(state.hunger).toBe(start.hunger);
  });
});

describe("applyAction(pet)", () => {
  it("nudges affection up and boredom down", () => {
    const start = { ...newPetState(), affection: 50, boredom: 50 };
    const { state } = applyAction(start, "pet");
    expect(state.affection).toBeGreaterThan(start.affection);
    expect(state.boredom).toBeLessThan(start.boredom);
    // Pat finishes on a happy celebrate pose after the blush moment.
    expect(state.currentAnimation).toBe("celebrate");
  });

  it("plays a blush → celebrate sequence", () => {
    const { steps } = applyAction(newPetState(), "pet");
    const animations = steps.map((s) => s.animation);
    expect(animations[0]).toBe("blush");
    expect(animations[animations.length - 1]).toBe("celebrate");
  });

  it("never drives affection above 100 even at the cap", () => {
    const start = { ...newPetState(), affection: 100 };
    const { state } = applyAction(start, "pet");
    expect(state.affection).toBe(100);
  });

  it("never drives boredom below 0 even at the floor", () => {
    const start = { ...newPetState(), boredom: 0 };
    const { state } = applyAction(start, "pet");
    expect(state.boredom).toBe(0);
  });
});

describe("applyAction immutability and metadata", () => {
  it("does not mutate the input state", () => {
    const start = { ...newPetState(), hunger: 60, affection: 30 };
    const snapshot = { ...start };
    applyAction(start, "feed");
    expect(start).toEqual(snapshot);
  });

  it("returns a fresh ISO timestamp on lastInteractionAt", () => {
    const start = { ...newPetState(), lastInteractionAt: null };
    const before = Date.now();
    const { state } = applyAction(start, "play");
    const after = Date.now();
    expect(state.lastInteractionAt).not.toBeNull();
    const t = Date.parse(state.lastInteractionAt as string);
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });

  it("returns the matching event metadata", () => {
    for (const k of ALL_KEYS) {
      const { eventType, salience } = applyAction(newPetState(), k);
      expect(eventType).toBe(ACTION_DEFINITIONS[k].eventType);
      expect(salience).toBe(ACTION_DEFINITIONS[k].salience);
    }
  });

  it("returns a non-empty bubble string for every action", () => {
    for (const k of ALL_KEYS) {
      const { bubble } = applyAction(newPetState(), k);
      expect(typeof bubble).toBe("string");
      expect(bubble.length).toBeGreaterThan(0);
    }
  });

  it("returns a non-empty steps array whose last entry matches state.currentAnimation", () => {
    for (const k of ALL_KEYS) {
      const { steps, state } = applyAction(newPetState(), k);
      expect(steps.length).toBeGreaterThan(0);
      expect(steps[steps.length - 1].animation).toBe(state.currentAnimation);
    }
  });
});
