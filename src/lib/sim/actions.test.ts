import { describe, it, expect } from "vitest";
import { newPetState } from "./state";
import {
  ACTION_KEYS,
  ACTION_DEFINITIONS,
  applyAction,
  type ActionKey,
} from "./actions";

const ALL_KEYS: ActionKey[] = ["feed", "play", "rest", "pet"];

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
    expect(state.currentAnimation).toBe("celebrate");
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
    expect(state.currentAnimation).toBe("jump");
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
    expect(state.currentAnimation).toBe("jump");
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
});
