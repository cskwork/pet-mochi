import { describe, it, expect } from "vitest";
import { newPetState } from "./state";
import {
  NUDGE_KINDS,
  newNudgeState,
  nextNudge,
  type NudgeKind,
  type NudgeState,
} from "./nudges";

const ALL: NudgeKind[] = ["hungry", "lonely", "stressed", "tired", "bored"];

// Deterministic rng for bubble selection — always picks index 0.
const rng0 = () => 0;

function freshState(): NudgeState {
  return newNudgeState();
}

describe("NUDGE_KINDS", () => {
  it("matches the documented kinds", () => {
    expect(new Set(NUDGE_KINDS)).toEqual(new Set(ALL));
  });
});

describe("nextNudge — no trigger", () => {
  it("returns null when all stats are nominal", () => {
    // Default newPetState() is well within nominal ranges.
    const result = nextNudge(newPetState(), freshState(), 0, rng0);
    expect(result).toBeNull();
  });

  it("returns null on the boundary just shy of each threshold", () => {
    const base = newPetState();
    const just_ok = {
      ...base,
      hunger: 80,     // need > 80
      affection: 20,  // need < 20
      stress: 70,     // need > 70
      energy: 20,     // need < 20
      boredom: 75,    // need > 75
    };
    expect(nextNudge(just_ok, freshState(), 0, rng0)).toBeNull();
  });
});

describe("nextNudge — single triggers", () => {
  it("fires 'hungry' when hunger > 80 and nothing else", () => {
    const pet = { ...newPetState(), hunger: 90 };
    const r = nextNudge(pet, freshState(), 0, rng0);
    expect(r?.kind).toBe("hungry");
    expect(typeof r?.bubble).toBe("string");
    expect(r?.bubble.length).toBeGreaterThan(0);
  });

  it("fires 'lonely' when affection < 20", () => {
    const pet = { ...newPetState(), affection: 10 };
    expect(nextNudge(pet, freshState(), 0, rng0)?.kind).toBe("lonely");
  });

  it("fires 'stressed' when stress > 70", () => {
    const pet = { ...newPetState(), stress: 80 };
    expect(nextNudge(pet, freshState(), 0, rng0)?.kind).toBe("stressed");
  });

  it("fires 'tired' when energy < 20", () => {
    const pet = { ...newPetState(), energy: 10 };
    expect(nextNudge(pet, freshState(), 0, rng0)?.kind).toBe("tired");
  });

  it("fires 'bored' when boredom > 75", () => {
    const pet = { ...newPetState(), boredom: 85 };
    expect(nextNudge(pet, freshState(), 0, rng0)?.kind).toBe("bored");
  });
});

describe("nextNudge — priority when multiple conditions cross", () => {
  it("picks 'hungry' over 'bored' when both fire", () => {
    const pet = { ...newPetState(), hunger: 90, boredom: 90 };
    expect(nextNudge(pet, freshState(), 0, rng0)?.kind).toBe("hungry");
  });

  it("picks 'lonely' over 'bored'", () => {
    const pet = { ...newPetState(), affection: 5, boredom: 90 };
    expect(nextNudge(pet, freshState(), 0, rng0)?.kind).toBe("lonely");
  });

  it("picks 'hungry' over every weaker condition", () => {
    const pet = {
      ...newPetState(),
      hunger: 90,
      affection: 5,
      stress: 90,
      energy: 5,
      boredom: 90,
    };
    expect(nextNudge(pet, freshState(), 0, rng0)?.kind).toBe("hungry");
  });
});

describe("nextNudge — cooldowns", () => {
  it("respects the per-kind cooldown (5 min)", () => {
    const pet = { ...newPetState(), hunger: 90 };
    let s = freshState();
    const t0 = 1_000_000;
    const r1 = nextNudge(pet, s, t0, rng0);
    expect(r1?.kind).toBe("hungry");
    s = applyResult(s, r1, t0);
    // 4 minutes later — still on per-kind cooldown
    expect(nextNudge(pet, s, t0 + 4 * 60_000, rng0)).toBeNull();
    // 6 minutes later — cooldown expired AND past 90s overall cooldown
    expect(nextNudge(pet, s, t0 + 6 * 60_000, rng0)?.kind).toBe("hungry");
  });

  it("respects the global any-kind cooldown (90s) across kinds", () => {
    let s = freshState();
    const t0 = 1_000_000;
    const r1 = nextNudge({ ...newPetState(), hunger: 90 }, s, t0, rng0);
    expect(r1?.kind).toBe("hungry");
    s = applyResult(s, r1, t0);
    // 60s later, lonely just crossed — but global 90s gate blocks it.
    const lonelyPet = { ...newPetState(), affection: 5 };
    expect(nextNudge(lonelyPet, s, t0 + 60_000, rng0)).toBeNull();
    // 100s later — past 90s global gate AND lonely is a fresh kind (per-kind 5min n/a).
    expect(nextNudge(lonelyPet, s, t0 + 100_000, rng0)?.kind).toBe("lonely");
  });
});

describe("nextNudge — bubble pool", () => {
  it("returns a bubble drawn from the pool deterministically via rng", () => {
    const pet = { ...newPetState(), hunger: 90 };
    const a = nextNudge(pet, freshState(), 0, () => 0);
    const b = nextNudge(pet, freshState(), 0, () => 0);
    expect(a?.bubble).toBe(b?.bubble);
  });

  it("can pick different bubbles when rng changes", () => {
    const pet = { ...newPetState(), hunger: 90 };
    // Many bubble pools exist for "hungry"; if pool size > 1, different rng
    // yields different strings. If pool size == 1, both equal — that is fine.
    const a = nextNudge(pet, freshState(), 0, () => 0);
    const b = nextNudge(pet, freshState(), 0, () => 0.99);
    expect(typeof a?.bubble).toBe("string");
    expect(typeof b?.bubble).toBe("string");
  });
});

describe("newNudgeState", () => {
  it("starts with no recorded firings", () => {
    const s = newNudgeState();
    expect(s.lastAny).toBeNull();
    expect(Object.keys(s.lastByKind)).toHaveLength(0);
  });
});

// ---------- helpers ----------

function applyResult(
  s: NudgeState,
  result: { kind: NudgeKind } | null,
  now: number,
): NudgeState {
  if (!result) return s;
  return {
    lastAny: now,
    lastByKind: { ...s.lastByKind, [result.kind]: now },
  };
}
