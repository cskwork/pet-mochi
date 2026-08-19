import { describe, expect, it } from "vitest";
import {
  GREETING_BUBBLES,
  GREETING_TIER_MINUTES,
  greetingForReturn,
} from "./greetings";
import { CHOREOGRAPHY_CATALOG } from "./choreography";

const fixedRng = (n: number) => () => n;

describe("REQ-108 welcome-back tiers — boundaries", () => {
  it("below 30 minutes there is no greeting", () => {
    expect(greetingForReturn(0, fixedRng(0))).toBeNull();
    expect(greetingForReturn(29.9, fixedRng(0))).toBeNull();
  });

  it("30m–2h → warm", () => {
    expect(greetingForReturn(GREETING_TIER_MINUTES.WARM_MIN, fixedRng(0))!.tier).toBe("warm");
    expect(greetingForReturn(119.9, fixedRng(0))!.tier).toBe("warm");
  });

  it("2h–8h → delight with a heart burst", () => {
    const g = greetingForReturn(GREETING_TIER_MINUTES.DELIGHT_MIN, fixedRng(0))!;
    expect(g.tier).toBe("delight");
    expect(g.burst).toBe("hearts");
  });

  it("8h+ → longing with a big heart burst", () => {
    const g = greetingForReturn(GREETING_TIER_MINUTES.LONGING_MIN, fixedRng(0))!;
    expect(g.tier).toBe("longing");
    expect(g.burst).toBe("hearts_big");
    expect(g.steps.length).toBeGreaterThanOrEqual(3);
  });
});

describe("REQ-108 greeting steps come from the closed pose vocabulary", () => {
  it("warm reuses greet_returning catalog variants", () => {
    const g = greetingForReturn(45, fixedRng(0))!;
    expect(CHOREOGRAPHY_CATALOG.greet_returning.variants).toContainEqual(g.steps);
  });

  it("delight reuses delight_burst catalog variants", () => {
    const g = greetingForReturn(200, fixedRng(0))!;
    expect(CHOREOGRAPHY_CATALOG.delight_burst.variants).toContainEqual(g.steps);
  });

  it("is deterministic for a fixed rng", () => {
    expect(greetingForReturn(600, fixedRng(0.4))).toEqual(
      greetingForReturn(600, fixedRng(0.4)),
    );
  });
});

describe("REQ-108 kindness constraint — no guilt copy, ever", () => {
  // Research finding #2: celebrate the return, never catastrophize the lapse.
  // These fragments are the guilt-pattern vocabulary the PRD forbids.
  const FORBIDDEN = [
    /finally/i,
    /left me/i,
    /where were you/i,
    /so long/i,
    /alone/i,
    /forgot/i,
    /ignor/i, // ignore, ignoring, ignored
    /waited/i,
    /why did/i,
  ];

  it("no bubble in any tier matches a guilt pattern", () => {
    for (const pool of Object.values(GREETING_BUBBLES)) {
      for (const line of pool) {
        for (const pattern of FORBIDDEN) {
          expect(pattern.test(line), `"${line}" vs ${pattern}`).toBe(false);
        }
      }
    }
  });

  it("every tier has at least two lines so greetings don't feel canned", () => {
    for (const pool of Object.values(GREETING_BUBBLES)) {
      expect(pool.length).toBeGreaterThanOrEqual(2);
    }
  });
});
