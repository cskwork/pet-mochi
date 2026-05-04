import { describe, expect, it, beforeEach } from "vitest";
import {
  applyDecay,
  applyInteraction,
  chooseMovement,
  computeAwayMinutes,
  deriveMood,
  newPetState,
  nextWanderPosition,
  roundStats,
  runTick,
  type PetState,
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

  // Stress is only ever decreased by decay/interactions/actions, so the old
  // `stress > 65 → "focused"` branch was unreachable. The Mood union no
  // longer contains "focused"; assert that at the highest possible stress the
  // result is still one of the live moods (and specifically not the removed
  // literal cast through `as any`).
  it("does not return 'focused' even at maximum stress", () => {
    const s = { ...newPetState(), stress: 100 };
    const mood = deriveMood(s);
    expect(mood).not.toBe("focused" as unknown as typeof mood);
    expect(["happy", "curious", "tired", "hungry", "bored", "lonely"]).toContain(mood);
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

  // Without bidirectional pressure on curiosity it climbs forever past the
  // 70-point "?" threshold and the curious mark never goes away. Curiosity
  // should slowly fade if nothing novel happens — same shape as boredom but
  // gentler so a brief cursor-away doesn't kill the curious look entirely.
  it("decays curiosity slowly so it doesn't pin at 100 forever", () => {
    const s = { ...newPetState(), curiosity: 80 };
    const out = applyDecay(s, 60);
    expect(out.curiosity).toBeLessThan(s.curiosity);
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

  // Bond should loosen across multi-day absences but never erode within a
  // single session — ~24h of zero interaction sheds a small but measurable
  // amount of relationshipLevel.
  it("drops relationshipLevel a small but measurable amount over a 24h absence", () => {
    const longAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const s = {
      ...newPetState(),
      relationshipLevel: 50,
      lastInteractionAt: longAgo,
    };
    const out = applyDecay(s, 24 * 60 * 60);
    const drop = s.relationshipLevel - out.relationshipLevel;
    expect(drop).toBeGreaterThan(0);
    expect(drop).toBeGreaterThanOrEqual(1);
    expect(drop).toBeLessThanOrEqual(3);
  });

  it("barely changes relationshipLevel on a short within-session tick", () => {
    const longAgo = new Date(Date.now() - 31 * 60_000).toISOString();
    const s = {
      ...newPetState(),
      relationshipLevel: 50,
      lastInteractionAt: longAgo,
    };
    const out = applyDecay(s, 5);
    expect(Math.abs(s.relationshipLevel - out.relationshipLevel)).toBeLessThan(0.01);
  });

  it("never decays relationshipLevel below 0", () => {
    const longAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const s = {
      ...newPetState(),
      relationshipLevel: 0,
      lastInteractionAt: longAgo,
    };
    const out = applyDecay(s, 7 * 24 * 60 * 60);
    expect(out.relationshipLevel).toBeGreaterThanOrEqual(0);
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
    expect(shouldCallLLM({ type: "STATUS_REPORT_DUE" }, s)).toBe(true);
    expect(shouldCallLLM({ type: "STATUS_REPORT_DUE" }, s)).toBe(false);
  });

  it("eventImportance covers all variants", () => {
    expect(eventImportance({ type: "APP_STARTED" })).toBeGreaterThan(0);
    expect(eventImportance({ type: "USER_HOVERED_PET" })).toBeGreaterThanOrEqual(0);
  });
});

// PRD §21.3: lastInteractionAt persists across restart and awayMinutes is
// computed from that persisted timestamp (not session start).
describe("computeAwayMinutes / persistence regression", () => {
  it("returns null for a missing timestamp so callers can fall back", () => {
    expect(computeAwayMinutes(null, Date.now())).toBeNull();
    expect(computeAwayMinutes(undefined, Date.now())).toBeNull();
  });

  it("returns null for an unparseable timestamp", () => {
    expect(computeAwayMinutes("not-a-date", Date.now())).toBeNull();
  });

  it("derives minutes-since from a persisted RFC3339 timestamp", () => {
    const now = Date.parse("2026-05-03T12:30:00Z");
    const past = new Date(now - 47 * 60_000).toISOString();
    const minutes = computeAwayMinutes(past, now);
    expect(minutes).not.toBeNull();
    expect(minutes!).toBeCloseTo(47, 5);
  });

  it("survives a save → serialize → load round-trip (simulated restart)", () => {
    // Build a PetState whose lastInteractionAt is N minutes in the past.
    const now = Date.parse("2026-05-03T12:30:00Z");
    const awayMinutesExpected = 90;
    const past = new Date(now - awayMinutesExpected * 60_000).toISOString();
    const before: PetState = { ...newPetState("Mochi"), lastInteractionAt: past };

    // Simulate the bridge: save_pet_state serializes via serde → JSON →
    // load_pet_state deserializes. We round-trip through JSON to mirror the
    // tauri invoke boundary; if `lastInteractionAt` were dropped or renamed,
    // this would surface here.
    const after = JSON.parse(JSON.stringify(before)) as PetState;
    expect(after.lastInteractionAt).toBe(past);

    // The same helper Pet.svelte uses on sync should now produce the
    // expected awayMinutes (within ±1 min of the configured value).
    const minutes = computeAwayMinutes(after.lastInteractionAt, now);
    expect(minutes).not.toBeNull();
    expect(Math.abs(minutes! - awayMinutesExpected)).toBeLessThanOrEqual(1);
  });
});

describe("roundStats (persistence boundary)", () => {
  // The backend's PetState models stat fields as `i32`. Tauri's serde
  // deserialization will reject fractional inputs with "invalid type:
  // floating point". applyDecay accumulates fractions every tick, so the
  // raw `pet` is almost always non-integer after the first ~3 seconds —
  // this helper is the canonical pre-save sanitization.
  it("rounds every integer stat field", () => {
    const fractional: PetState = {
      ...newPetState(),
      hunger: 49.7,
      energy: 80.4,
      affection: 50.5,
      boredom: 20.123,
      curiosity: 60.999,
      stress: 9.4,
      trust: 50.5001,
      relationshipLevel: 0.999754,
    };
    const rounded = roundStats(fractional);
    // Every integer field is now a whole number.
    for (const key of [
      "hunger",
      "energy",
      "affection",
      "boredom",
      "curiosity",
      "stress",
      "trust",
      "relationshipLevel",
    ] as const) {
      expect(Number.isInteger(rounded[key])).toBe(true);
    }
    // Spot-check the rounding direction matches Math.round semantics.
    expect(rounded.hunger).toBe(50);
    expect(rounded.energy).toBe(80);
    expect(rounded.relationshipLevel).toBe(1);
  });

  it("does not mutate the input", () => {
    const fractional: PetState = { ...newPetState(), affection: 49.7 };
    const snapshot = { ...fractional };
    roundStats(fractional);
    expect(fractional).toEqual(snapshot);
  });

  it("preserves non-numeric fields verbatim", () => {
    const s: PetState = {
      ...newPetState(),
      hunger: 49.7,
      lastInteractionAt: "2026-05-03T12:30:00Z",
      currentAnimation: "yawn",
    };
    const r = roundStats(s);
    expect(r.lastInteractionAt).toBe(s.lastInteractionAt);
    expect(r.currentAnimation).toBe(s.currentAnimation);
    expect(r.id).toBe(s.id);
    expect(r.name).toBe(s.name);
  });
});
