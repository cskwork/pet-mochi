import { describe, expect, it } from "vitest";
import {
  AWAY_AFTER_MS,
  RETURN_BURST_MS,
  minutesSinceActivity,
  newPresence,
  notePresenceActivity,
  userJustReturned,
} from "./presence";
import { greetingForReturn } from "./greetings";

const T0 = 1_000_000_000_000;

describe("presence (real activity, not pet clicks)", () => {
  it("steady activity never reads as a return", () => {
    let p = newPresence(T0);
    // Cursor moves every minute for 3 hours without ever clicking Mochi.
    for (let m = 1; m <= 180; m++) {
      const r = notePresenceActivity(p, T0 + m * 60_000);
      expect(r.returnedAfterMinutes).toBeNull();
      p = r.state;
    }
    expect(userJustReturned(p, T0 + 180 * 60_000)).toBe(false);
  });

  it("fires once on the away→active edge with the real away duration", () => {
    const p = newPresence(T0);
    const back = T0 + 130 * 60_000;
    const r = notePresenceActivity(p, back);
    expect(r.returnedAfterMinutes).toBeCloseTo(130, 5);
    // The 120-minute "delight" tier is reachable now.
    expect(greetingForReturn(r.returnedAfterMinutes!, () => 0)!.tier).toBe("delight");
    const again = notePresenceActivity(r.state, back + 500);
    expect(again.returnedAfterMinutes).toBeNull();
  });

  it("just under the away threshold is not a return", () => {
    const r = notePresenceActivity(newPresence(T0), T0 + AWAY_AFTER_MS - 1);
    expect(r.returnedAfterMinutes).toBeNull();
  });

  it("userJustReturned is a short burst, not indefinite", () => {
    const r = notePresenceActivity(newPresence(T0), T0 + AWAY_AFTER_MS);
    const at = T0 + AWAY_AFTER_MS;
    expect(userJustReturned(r.state, at)).toBe(true);
    expect(userJustReturned(r.state, at + RETURN_BURST_MS - 1)).toBe(true);
    expect(userJustReturned(r.state, at + RETURN_BURST_MS)).toBe(false);
  });

  it("minutesSinceActivity tracks idle time", () => {
    const p = newPresence(T0);
    expect(minutesSinceActivity(p, T0 + 5 * 60_000)).toBeCloseTo(5, 5);
  });
});
