import { describe, it, expect } from "vitest";
import {
  CHOREOGRAPHY_CATALOG,
  CHOREOGRAPHY_KEYS,
  CLOSED_TOKENS,
  defaultBubbleFor,
  isChoreographyKey,
  isClosedToken,
  pickFallbackPreset,
  stepsForPick,
  validateChoreographyPayload,
} from "./choreography";
import { newPetState, type PetState } from "./state";
import type { PetEvent } from "./salience";

const MOODS = ["happy", "curious", "tired", "hungry", "bored", "lonely"] as const;

const EVENT_FACTORIES: Array<() => PetEvent> = [
  () => ({ type: "APP_STARTED" }),
  () => ({ type: "APP_CLOSING" }),
  () => ({ type: "USER_CLICKED_PET" }),
  () => ({ type: "USER_HOVERED_PET" }),
  () => ({ type: "USER_SENT_MESSAGE", text: "hi" }),
  () => ({ type: "USER_RETURNED", awayMinutes: 60 }),
  () => ({ type: "USER_RETURNED", awayMinutes: 5 }),
  () => ({ type: "IDLE_TICK" }),
  () => ({ type: "TIME_OF_DAY_CHANGED", period: "morning" }),
  () => ({ type: "TIME_OF_DAY_CHANGED", period: "night" }),
  () => ({ type: "FILE_FOUND_IN_INBOX", path: "x.md" }),
  () => ({ type: "FILE_INSPECTION_APPROVED", path: "x.md" }),
  () => ({ type: "MEMORY_CREATED", memoryId: "m1" }),
  () => ({ type: "LLM_RESPONSE_READY", requestId: "r1", text: "ok" }),
  () => ({ type: "STATUS_REPORT_DUE" }),
];

describe("choreography catalog (REQ-095)", () => {
  it("every catalog entry has at least one variant", () => {
    for (const key of CHOREOGRAPHY_KEYS) {
      expect(CHOREOGRAPHY_CATALOG[key].variants.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("every step in every variant has a positive duration", () => {
    for (const key of CHOREOGRAPHY_KEYS) {
      for (const variant of CHOREOGRAPHY_CATALOG[key].variants) {
        expect(variant.length).toBeGreaterThan(0);
        for (const step of variant) {
          expect(step.durationMs).toBeGreaterThan(0);
          expect(typeof step.animation).toBe("string");
        }
      }
    }
  });

  it("default bubbles are always either null or a valid closed token", () => {
    for (const key of CHOREOGRAPHY_KEYS) {
      const b = defaultBubbleFor(key);
      if (b !== null) {
        expect(CLOSED_TOKENS).toContain(b);
      }
    }
  });
});

describe("validateChoreographyPayload (REQ-099)", () => {
  it("accepts a well-formed payload with all three fields", () => {
    const out = validateChoreographyPayload({
      preset: "greet_returning",
      variant: 0,
      bubble: "♡",
    });
    expect(out).not.toBeNull();
    expect(out?.preset).toBe("greet_returning");
    expect(out?.variant).toBe(0);
    expect(out?.bubble).toBe("♡");
  });

  it("accepts payload without bubble (treats as null)", () => {
    const out = validateChoreographyPayload({ preset: "delight_burst", variant: 1 });
    expect(out?.bubble).toBeNull();
  });

  it("treats empty-string and null bubble as null", () => {
    expect(validateChoreographyPayload({ preset: "delight_burst", variant: 0, bubble: "" })?.bubble).toBeNull();
    expect(validateChoreographyPayload({ preset: "delight_burst", variant: 0, bubble: null })?.bubble).toBeNull();
  });

  it("rejects unknown preset keys (REQ-098 fallback trigger)", () => {
    expect(
      validateChoreographyPayload({ preset: "totally_made_up", variant: 0 }),
    ).toBeNull();
  });

  it("rejects variant index out of range for the picked preset", () => {
    const variants = CHOREOGRAPHY_CATALOG.confused_hesitate.variants.length;
    expect(
      validateChoreographyPayload({ preset: "confused_hesitate", variant: variants }),
    ).toBeNull();
    expect(
      validateChoreographyPayload({ preset: "confused_hesitate", variant: -1 }),
    ).toBeNull();
  });

  it("rejects non-integer variant", () => {
    expect(
      validateChoreographyPayload({ preset: "delight_burst", variant: 0.5 }),
    ).toBeNull();
  });

  it("rejects free-text bubble (no human sentences) — REQ-096", () => {
    expect(
      validateChoreographyPayload({
        preset: "greet_returning",
        variant: 0,
        bubble: "Welcome back, friend!",
      }),
    ).toBeNull();
    expect(
      validateChoreographyPayload({
        preset: "greet_returning",
        variant: 0,
        bubble: "<script>alert(1)</script>",
      }),
    ).toBeNull();
  });

  it("rejects garbage shapes outright", () => {
    expect(validateChoreographyPayload(null)).toBeNull();
    expect(validateChoreographyPayload(42)).toBeNull();
    expect(validateChoreographyPayload("nope")).toBeNull();
    expect(validateChoreographyPayload([])).toBeNull();
    expect(validateChoreographyPayload({})).toBeNull();
    expect(validateChoreographyPayload({ preset: 1, variant: 0 })).toBeNull();
  });

  it("type-guards line up with the catalog", () => {
    for (const k of CHOREOGRAPHY_KEYS) expect(isChoreographyKey(k)).toBe(true);
    for (const t of CLOSED_TOKENS) expect(isClosedToken(t)).toBe(true);
    expect(isChoreographyKey("not_a_key")).toBe(false);
    expect(isClosedToken("hello")).toBe(false);
  });

  it("stepsForPick returns the variant at the validated index", () => {
    const pick = validateChoreographyPayload({
      preset: "playful_wiggle",
      variant: 0,
      bubble: "nyu",
    });
    expect(pick).not.toBeNull();
    if (pick) {
      const steps = stepsForPick(pick);
      expect(steps).toBe(CHOREOGRAPHY_CATALOG.playful_wiggle.variants[0]);
    }
  });
});

describe("pickFallbackPreset — REQ-098 exhaustiveness", () => {
  it("yields a valid catalog key for every (mood × event) combination", () => {
    for (const mood of MOODS) {
      for (const factory of EVENT_FACTORIES) {
        const state: PetState = { ...newPetState(), mood };
        const event = factory();
        const pick = pickFallbackPreset(state, event);
        expect(CHOREOGRAPHY_KEYS).toContain(pick.preset);
        // Variant must be in range for the chosen preset.
        const variantCount = CHOREOGRAPHY_CATALOG[pick.preset].variants.length;
        expect(pick.variant).toBeGreaterThanOrEqual(0);
        expect(pick.variant).toBeLessThan(variantCount);
        // Bubble must be valid (or null).
        if (pick.bubble !== null) {
          expect(CLOSED_TOKENS).toContain(pick.bubble);
        }
      }
    }
  });

  it("is deterministic — same (state, event) always picks the same variant", () => {
    const state = { ...newPetState(), mood: "happy" as const };
    const ev: PetEvent = { type: "USER_RETURNED", awayMinutes: 60 };
    const a = pickFallbackPreset(state, ev);
    const b = pickFallbackPreset(state, ev);
    expect(a).toEqual(b);
  });

  it("USER_RETURNED with long absence picks greet_returning", () => {
    const state = newPetState();
    const pick = pickFallbackPreset(state, { type: "USER_RETURNED", awayMinutes: 90 });
    expect(pick.preset).toBe("greet_returning");
  });

  it("USER_RETURNED with short absence picks playful_wiggle", () => {
    const state = newPetState();
    const pick = pickFallbackPreset(state, { type: "USER_RETURNED", awayMinutes: 5 });
    expect(pick.preset).toBe("playful_wiggle");
  });

  it("STATUS_REPORT_DUE picks sleepy_settle (silent ambient gesture)", () => {
    const state = newPetState();
    const pick = pickFallbackPreset(state, { type: "STATUS_REPORT_DUE" });
    expect(pick.preset).toBe("sleepy_settle");
  });

  it("steps from a fallback pick are non-empty MovementState sequences", () => {
    const state = { ...newPetState(), mood: "lonely" as const };
    const pick = pickFallbackPreset(state, { type: "IDLE_TICK" });
    const steps = stepsForPick(pick);
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) {
      expect(typeof s.animation).toBe("string");
      expect(s.durationMs).toBeGreaterThan(0);
    }
  });
});
