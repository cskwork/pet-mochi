import { describe, expect, it, beforeEach } from "vitest";
import {
  applyDecay,
  applyInteraction,
  chooseMovement,
  deriveMood,
  newPetState,
  nextWanderPosition,
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

  // Tamagotchi-feel rates: stat changes must be noticeable in the status bars
  // within a minute or two. Rates below are calibrated so the user actually
  // sees the gauges drift, instead of having to wait 25+ minutes.
  it("drains energy by at least 4 points per minute while awake", () => {
    const s = { ...newPetState(), energy: 80 };
    const out = applyDecay(s, 60);
    expect(s.energy - out.energy).toBeGreaterThanOrEqual(4);
  });

  it("recovers energy by at least 25 points per minute while sleeping", () => {
    const s = { ...newPetState(), energy: 20, currentAnimation: "sleep" as const };
    const out = applyDecay(s, 60);
    expect(out.energy - s.energy).toBeGreaterThanOrEqual(25);
  });

  it("raises hunger by at least 4 points per minute", () => {
    const s = { ...newPetState(), hunger: 30 };
    const out = applyDecay(s, 60);
    expect(out.hunger - s.hunger).toBeGreaterThanOrEqual(4);
  });

  it("raises boredom by at least 4 points per minute", () => {
    const s = { ...newPetState(), boredom: 20 };
    const out = applyDecay(s, 60);
    expect(out.boredom - s.boredom).toBeGreaterThanOrEqual(4);
  });

  it("recovers stress slowly when no negative pressure", () => {
    const s = { ...newPetState(), stress: 50 };
    const out = applyDecay(s, 120);
    expect(out.stress).toBeLessThan(s.stress);
  });

  it("drops affection when no interaction in 30+ minutes", () => {
    const longAgo = new Date(Date.now() - 31 * 60_000).toISOString();
    const s = { ...newPetState(), affection: 60, lastInteractionAt: longAgo };
    const out = applyDecay(s, 60);
    expect(out.affection).toBeLessThan(s.affection);
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

describe("nextWanderPosition with obstacles", () => {
  // 360x360 viewport with petSize 60. Status box top-left, actions box
  // bottom-right — the pet must never settle inside either.
  const bounds = { width: 360, height: 360, petSize: 60 };
  const obstacles = [
    { left: 0, top: 0, right: 200, bottom: 100 },        // top-left status panel
    { left: 200, top: 280, right: 360, bottom: 360 },    // bottom-right actions panel
  ];

  it("returns a non-overlapping position when obstacles are passed", () => {
    // Start near the status box; many random walks should still keep the
    // pet's rect outside every obstacle.
    let pos = { x: 10, y: 10 };
    for (let i = 0; i < 50; i++) {
      pos = nextWanderPosition(pos, bounds, obstacles, seededRng);
      const petRect = {
        left: pos.x,
        top: pos.y,
        right: pos.x + bounds.petSize,
        bottom: pos.y + bounds.petSize,
      };
      for (const obs of obstacles) {
        const overlaps =
          petRect.left < obs.right &&
          petRect.right > obs.left &&
          petRect.top < obs.bottom &&
          petRect.bottom > obs.top;
        expect(overlaps).toBe(false);
      }
    }
  });

  it("with no obstacles passed, behaves as a free wander", () => {
    const pos = nextWanderPosition({ x: 100, y: 100 }, bounds, undefined, seededRng);
    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.x).toBeLessThanOrEqual(bounds.width - bounds.petSize);
    expect(pos.y).toBeGreaterThanOrEqual(0);
    expect(pos.y).toBeLessThanOrEqual(bounds.height - bounds.petSize);
  });

  it("when stuck inside an obstacle, never returns a worse position", () => {
    // Start INSIDE the top-left obstacle; the result must not still be inside it.
    const stuck = { x: 0, y: 0 };
    const result = nextWanderPosition(stuck, bounds, obstacles, seededRng);
    const inObstacle =
      result.x < obstacles[0].right &&
      result.x + bounds.petSize > obstacles[0].left &&
      result.y < obstacles[0].bottom &&
      result.y + bounds.petSize > obstacles[0].top;
    expect(inObstacle).toBe(false);
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
