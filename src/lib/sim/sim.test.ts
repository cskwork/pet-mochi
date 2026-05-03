import { describe, expect, it, beforeEach } from "vitest";
import {
  applyDecay,
  applyInteraction,
  chooseMovement,
  deriveMood,
  newPetState,
  runTick,
  type RuntimeContext,
} from "./index";
import {
  _resetCooldowns,
  eventImportance,
  shouldCallLLM,
} from "./salience";

const ctx: RuntimeContext = {
  cursorNearPet: false,
  userJustReturned: false,
  recentPositiveEvent: false,
  awayMinutes: 0,
  timeOfDay: "afternoon",
};

const seededRng = (() => {
  let seed = 42;
  return () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
})();

describe("deriveMood", () => {
  it("returns tired when energy is critical", () => {
    const s = { ...newPetState(), energy: 10 };
    expect(deriveMood(s)).toBe("tired");
  });
  it("returns hungry over bored when both apply", () => {
    const s = { ...newPetState(), hunger: 80, boredom: 90 };
    expect(deriveMood(s)).toBe("hungry");
  });
  it("returns happy by default", () => {
    expect(deriveMood(newPetState())).toBe("happy");
  });
});

describe("chooseMovement", () => {
  it("sleeps when energy is low", () => {
    const s = { ...newPetState(), energy: 5 };
    expect(chooseMovement(s, ctx, seededRng)).toBe("sleep");
  });

  it("runs when user just returned", () => {
    const s = newPetState();
    expect(chooseMovement(s, { ...ctx, userJustReturned: true }, seededRng)).toBe(
      "run",
    );
  });

  it("looks at cursor when nearby", () => {
    const s = newPetState();
    expect(chooseMovement(s, { ...ctx, cursorNearPet: true }, seededRng)).toBe(
      "look_cursor",
    );
  });

  it("walks when bored", () => {
    const s = { ...newPetState(), boredom: 90 };
    expect(chooseMovement(s, ctx, seededRng)).toBe("walk");
  });

  it("celebrates when happy and recent positive event", () => {
    const s = { ...newPetState(), mood: "happy" as const };
    expect(
      chooseMovement(s, { ...ctx, recentPositiveEvent: true }, seededRng),
    ).toBe("celebrate");
  });
});

describe("applyDecay", () => {
  it("recovers energy while sleeping", () => {
    const s = { ...newPetState(), energy: 30, currentAnimation: "sleep" as const };
    const out = applyDecay(s, 60);
    expect(out.energy).toBeGreaterThan(s.energy);
  });

  it("drains energy slowly while awake", () => {
    const s = { ...newPetState(), energy: 50 };
    const out = applyDecay(s, 60);
    expect(out.energy).toBeLessThan(s.energy);
  });

  it("clamps stats between 0 and 100", () => {
    const s = { ...newPetState(), hunger: 99 };
    const out = applyDecay(s, 100_000);
    expect(out.hunger).toBeLessThanOrEqual(100);
    expect(out.hunger).toBeGreaterThanOrEqual(0);
  });

  it("noop on zero seconds", () => {
    const s = newPetState();
    expect(applyDecay(s, 0)).toBe(s);
  });
});

describe("applyInteraction", () => {
  it("click increases affection and reduces boredom", () => {
    const before = newPetState();
    const after = applyInteraction(before, "click");
    expect(after.affection).toBeGreaterThan(before.affection);
    expect(after.boredom).toBeLessThanOrEqual(before.boredom);
    expect(after.lastInteractionAt).toBeTruthy();
  });

  it("ignore decreases affection", () => {
    const before = newPetState();
    const after = applyInteraction(before, "ignore");
    expect(after.affection).toBeLessThan(before.affection);
  });
});

describe("runTick", () => {
  it("produces a fresh state with mood + animation set", () => {
    const s = newPetState();
    const out = runTick(s, ctx, 5);
    expect(out.mood).toBeDefined();
    expect(out.currentAnimation).toBeDefined();
    expect(out).not.toBe(s);
  });
});

describe("salience", () => {
  beforeEach(() => _resetCooldowns());

  it("user message always triggers LLM", () => {
    const s = newPetState();
    expect(
      shouldCallLLM({ type: "USER_SENT_MESSAGE", text: "hi" }, s),
    ).toBe(true);
  });

  it("idle ticks never trigger LLM", () => {
    const s = newPetState();
    expect(shouldCallLLM({ type: "IDLE_TICK" }, s)).toBe(false);
  });

  it("user returned after long absence triggers LLM", () => {
    const s = { ...newPetState(), affection: 30 };
    expect(
      shouldCallLLM({ type: "USER_RETURNED", awayMinutes: 60 }, s),
    ).toBe(true);
  });

  it("autonomous LLM call respects cooldown", () => {
    const s = newPetState();
    expect(shouldCallLLM({ type: "DAILY_REFLECTION_DUE" }, s)).toBe(true);
    expect(shouldCallLLM({ type: "DAILY_REFLECTION_DUE" }, s)).toBe(false);
  });

  it("eventImportance covers all variants", () => {
    expect(eventImportance({ type: "APP_STARTED" })).toBeGreaterThan(0);
    expect(eventImportance({ type: "USER_HOVERED_PET" })).toBeGreaterThanOrEqual(0);
  });
});
