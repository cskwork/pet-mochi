import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERSONALITY,
  PERSONALITIES,
  personalityFor,
  pickIdleVariant,
  type PersonalityParams,
} from "./personality";
import { chooseMovement, nextWanderDelta } from "./movement";
import { applyDecay } from "./decay";
import { nextQuirk, QUIRK_CHANCE, quirkPoolFor, QUIRK_POOLS } from "./quirks";
import { newNudgeState, nextNudge } from "./nudges";
import { newPetState, type Mood, type MovementState, type PetState, type RuntimeContext } from "./state";

const ctx: RuntimeContext = {
  cursorNearPet: false,
  userJustReturned: false,
  recentPositiveEvent: false,
  awayMinutes: 0,
  timeOfDay: "afternoon",
};

function seeded(seed = 7) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

/** The pre-personality chooseMovement, copied verbatim as the reference. */
function legacyChooseMovement(state: PetState, c: RuntimeContext, rng: () => number): MovementState {
  if (state.currentAnimation === "sleep" && state.energy < 60) return "sleep";
  if (state.energy < 15) return "sleep";
  if (c.userJustReturned) return "run";
  if (c.cursorNearPet) return "look_cursor";
  if (c.timeOfDay === "night" && state.energy < 30 && state.boredom < 60) return "sleep";
  if (state.boredom > 75) return "walk";
  if (state.mood === "happy" && c.recentPositiveEvent) return "celebrate";
  const arr: MovementState[] = ["idle", "sit", "look_cursor"];
  return arr[Math.floor(rng() * arr.length)];
}

describe("personality lookup", () => {
  it("unknown, empty, or missing presets fall back to curious", () => {
    for (const v of ["", "grumpy", null, undefined, "CURIOUS"]) {
      expect(personalityFor(v)).toBe(DEFAULT_PERSONALITY);
    }
    expect(DEFAULT_PERSONALITY.preset).toBe("curious");
    expect(personalityFor("lazy").preset).toBe("lazy");
  });
});

describe("curious reproduces the historical behavior exactly", () => {
  it("chooseMovement matches the legacy logic across a seeded sweep", () => {
    const pick = seeded(11);
    const moods: Mood[] = ["happy", "curious", "tired", "hungry", "bored", "lonely"];
    const times: RuntimeContext["timeOfDay"][] = ["morning", "afternoon", "evening", "night"];
    for (let i = 0; i < 2000; i++) {
      const s: PetState = {
        ...newPetState(),
        energy: pick() * 100,
        boredom: pick() * 100,
        mood: moods[Math.floor(pick() * moods.length)],
        currentAnimation: pick() < 0.2 ? "sleep" : "idle",
      };
      const c: RuntimeContext = {
        ...ctx,
        cursorNearPet: pick() < 0.2,
        userJustReturned: pick() < 0.1,
        recentPositiveEvent: pick() < 0.3,
        timeOfDay: times[Math.floor(pick() * times.length)],
      };
      const r = pick();
      expect(chooseMovement(s, c, () => r, PERSONALITIES.curious)).toBe(
        legacyChooseMovement(s, c, () => r),
      );
    }
  });

  it("equal idle weights equal the old uniform floor pick", () => {
    for (let r = 0; r < 1; r += 0.001) {
      expect(pickIdleVariant(PERSONALITIES.curious.idleWeights, r)).toBe(
        (["idle", "sit", "look_cursor"] as const)[Math.floor(r * 3)],
      );
    }
  });

  it("decay, wander step, quirks, and nudges are unchanged for curious", () => {
    const s = { ...newPetState(), energy: 50, boredom: 40 };
    expect({ ...applyDecay(s, 30, PERSONALITIES.curious), updatedAt: "" }).toEqual({
      ...applyDecay(s, 30),
      updatedAt: "",
    });
    const r = seeded(3);
    for (let i = 0; i < 200; i++) {
      const a = r();
      const b = r();
      const seq = [a, b];
      expect(nextWanderDelta(() => seq.shift()!, PERSONALITIES.curious.wanderStepScale)).toEqual({
        x: Math.round((a - 0.5) * 80),
        y: Math.round((b - 0.5) * 40),
      });
    }
    for (const mood of Object.keys(QUIRK_POOLS) as Mood[]) {
      expect(quirkPoolFor(mood, PERSONALITIES.curious)).toBe(QUIRK_POOLS[mood]);
    }
    const p = { ...newPetState(), currentAnimation: "idle" as const };
    expect(nextQuirk(p, null, 0, () => QUIRK_CHANCE - 0.001, 1, PERSONALITIES.curious)).not.toBeNull();
    expect(nextQuirk(p, null, 0, () => QUIRK_CHANCE, 1, PERSONALITIES.curious)).toBeNull();
  });
});

describe("each preset measurably shifts behavior", () => {
  function idleShare(pp: PersonalityParams, anim: MovementState): number {
    const rng = seeded(5);
    const s = { ...newPetState(), energy: 80, boredom: 20 };
    let n = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) if (chooseMovement(s, ctx, rng, pp) === anim) n++;
    return n / N;
  }

  it("idle-variant weights: lazy sits more, playful watches the cursor more, quiet idles more", () => {
    expect(idleShare(PERSONALITIES.lazy, "sit")).toBeGreaterThan(idleShare(PERSONALITIES.curious, "sit") + 0.1);
    expect(idleShare(PERSONALITIES.playful, "look_cursor")).toBeGreaterThan(
      idleShare(PERSONALITIES.curious, "look_cursor") + 0.1,
    );
    expect(idleShare(PERSONALITIES.quiet, "idle")).toBeGreaterThan(idleShare(PERSONALITIES.curious, "idle") + 0.05);
  });

  it("lazy sleeps earlier; playful stays up longer", () => {
    const tiredish = { ...newPetState(), energy: 18 };
    expect(chooseMovement(tiredish, ctx, () => 0, PERSONALITIES.lazy)).toBe("sleep");
    expect(chooseMovement(tiredish, ctx, () => 0, PERSONALITIES.curious)).not.toBe("sleep");
    const low = { ...newPetState(), energy: 13 };
    expect(chooseMovement(low, ctx, () => 0, PERSONALITIES.curious)).toBe("sleep");
    expect(chooseMovement(low, ctx, () => 0, PERSONALITIES.playful)).not.toBe("sleep");
  });

  it("wander frequency: playful walks at lower boredom, lazy needs more", () => {
    const s = { ...newPetState(), boredom: 70 };
    expect(chooseMovement(s, ctx, () => 0, PERSONALITIES.playful)).toBe("walk");
    expect(chooseMovement(s, ctx, () => 0, PERSONALITIES.curious)).not.toBe("walk");
    const s2 = { ...newPetState(), boredom: 80 };
    expect(chooseMovement(s2, ctx, () => 0, PERSONALITIES.curious)).toBe("walk");
    expect(chooseMovement(s2, ctx, () => 0, PERSONALITIES.lazy)).not.toBe("walk");
  });

  it("wander step size scales with the preset", () => {
    const mean = (pp: PersonalityParams) => {
      const rng = seeded(9);
      let sum = 0;
      for (let i = 0; i < 1000; i++) sum += Math.abs(nextWanderDelta(rng, pp.wanderStepScale).x);
      return sum / 1000;
    };
    expect(mean(PERSONALITIES.lazy)).toBeLessThan(mean(PERSONALITIES.curious) * 0.75);
    expect(mean(PERSONALITIES.playful)).toBeGreaterThan(mean(PERSONALITIES.curious) * 1.2);
  });

  it("quirk frequency: playful > curious > lazy > quiet", () => {
    const rate = (pp: PersonalityParams) => {
      const rng = seeded(13);
      const p = { ...newPetState(), currentAnimation: "idle" as const };
      let n = 0;
      for (let i = 0; i < 4000; i++) if (nextQuirk(p, null, 0, rng, 1, pp)) n++;
      return n / 4000;
    };
    const [pl, cu, la, qu] = [PERSONALITIES.playful, PERSONALITIES.curious, PERSONALITIES.lazy, PERSONALITIES.quiet].map(rate);
    expect(pl).toBeGreaterThan(cu);
    expect(cu).toBeGreaterThan(la);
    expect(la).toBeGreaterThan(qu);
  });

  it("presets add their own quirk chains for fitting moods", () => {
    const keys = (pp: PersonalityParams, m: Mood) => quirkPoolFor(m, pp).map((q) => q.key);
    expect(keys(PERSONALITIES.lazy, "tired")).toContain("lazy_flop");
    expect(keys(PERSONALITIES.playful, "happy")).toContain("playful_hop");
    expect(keys(PERSONALITIES.quiet, "happy")).toContain("quiet_settle");
    // No party chains when she's hungry.
    expect(keys(PERSONALITIES.playful, "hungry")).toEqual(QUIRK_POOLS.hungry.map((q) => q.key));
    for (const pp of Object.values(PERSONALITIES)) {
      for (const q of pp.extraQuirks) {
        expect(q.steps.length).toBeGreaterThanOrEqual(1);
        expect(q.steps.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it("quiet nudges less often (scaled cooldowns)", () => {
    const hungry = { ...newPetState(), hunger: 90 };
    const state = { lastByKind: {}, lastAny: 0 };
    const now = 120_000; // 2 min after the last nudge
    expect(nextNudge(hungry, state, now, () => 0, PERSONALITIES.curious.nudgeCooldownScale)).not.toBeNull();
    expect(nextNudge(hungry, state, now, () => 0, PERSONALITIES.quiet.nudgeCooldownScale)).toBeNull();
    expect(nextNudge(hungry, newNudgeState(), now, () => 0, PERSONALITIES.quiet.nudgeCooldownScale)).not.toBeNull();
  });

  it("gentle decay flavors: lazy tires a bit faster, playful gets bored a bit faster", () => {
    const s = { ...newPetState(), energy: 50, boredom: 40 };
    const lazy = applyDecay(s, 60, PERSONALITIES.lazy);
    const cur = applyDecay(s, 60, PERSONALITIES.curious);
    const play = applyDecay(s, 60, PERSONALITIES.playful);
    expect(lazy.energy).toBeLessThan(cur.energy);
    expect(cur.energy - lazy.energy).toBeLessThan(1); // modest: < 1 point/min
    expect(play.boredom).toBeGreaterThan(cur.boredom);
    expect(play.boredom - cur.boredom).toBeLessThan(1.5);
  });
});
