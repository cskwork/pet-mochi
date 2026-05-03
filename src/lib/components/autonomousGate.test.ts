import { describe, it, expect, vi, beforeEach } from "vitest";
import { tryEnterAutonomous, type LastAutonomous } from "./autonomousGate";

const COOLDOWN = 5 * 60_000;

describe("tryEnterAutonomous", () => {
  it("first call passes and returns the new timestamp", () => {
    const d = tryEnterAutonomous({
      inFlight: false,
      last: null,
      kind: "returned",
      now: 1_000,
      cooldownMs: COOLDOWN,
    });
    expect(d.proceed).toBe(true);
    if (d.proceed) {
      expect(d.nextLast).toEqual({ kind: "returned", ts: 1_000 });
    }
  });

  it("blocks same kind within the cooldown window", () => {
    const last: LastAutonomous = { kind: "returned", ts: 1_000 };
    const d = tryEnterAutonomous({
      inFlight: false,
      last,
      kind: "returned",
      now: 1_000 + COOLDOWN - 1,
      cooldownMs: COOLDOWN,
    });
    expect(d.proceed).toBe(false);
  });

  it("allows same kind again after the cooldown window", () => {
    const last: LastAutonomous = { kind: "returned", ts: 1_000 };
    const d = tryEnterAutonomous({
      inFlight: false,
      last,
      kind: "returned",
      now: 1_000 + COOLDOWN,
      cooldownMs: COOLDOWN,
    });
    expect(d.proceed).toBe(true);
  });

  it("blocks any kind while inFlight is true", () => {
    const d = tryEnterAutonomous({
      inFlight: true,
      last: null,
      kind: "morning",
      now: 999_999,
      cooldownMs: COOLDOWN,
    });
    expect(d.proceed).toBe(false);
  });
});

/**
 * Regression test for the re-entry race the gate is supposed to close.
 * Mirrors maybeAutonomousSpeak's call shape: two synchronous invocations
 * must result in only ONE api.autonomousSpeak call, even though the first
 * call hasn't resolved yet (so `lastAutonomousFor` is set, but a naive
 * implementation that delayed the timestamp write would let both through).
 */
describe("re-entry: two synchronous maybeAutonomousSpeak-style calls", () => {
  type FakeApi = { autonomousSpeak: (kind: string) => Promise<void> };

  let lastAutonomousFor: LastAutonomous;
  let inFlight: boolean;
  let api: FakeApi;
  let resolveFirst: () => void;

  // Tiny port of maybeAutonomousSpeak that uses the gate. If the call site in
  // Pet.svelte deviates from this shape, update both.
  async function maybeSpeak(kind: string, now: number): Promise<void> {
    const d = tryEnterAutonomous({
      inFlight,
      last: lastAutonomousFor,
      kind,
      now,
      cooldownMs: COOLDOWN,
    });
    if (!d.proceed) return;
    lastAutonomousFor = d.nextLast;
    inFlight = true;
    try {
      await api.autonomousSpeak(kind);
    } finally {
      inFlight = false;
    }
  }

  beforeEach(() => {
    lastAutonomousFor = null;
    inFlight = false;
    api = {
      autonomousSpeak: vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      ),
    };
  });

  it("only one api.autonomousSpeak invocation when called twice synchronously", async () => {
    const p1 = maybeSpeak("returned", 1_000);
    const p2 = maybeSpeak("returned", 1_001);
    expect(api.autonomousSpeak).toHaveBeenCalledTimes(1);
    resolveFirst();
    await Promise.all([p1, p2]);
    expect(api.autonomousSpeak).toHaveBeenCalledTimes(1);
  });

  it("a different kind is still blocked by inFlight even though cooldown allows it", async () => {
    const p1 = maybeSpeak("returned", 1_000);
    // Different kind would normally bypass the (kind, ts) check, but the
    // inFlight guard must still block it until p1 settles.
    const p2 = maybeSpeak("morning", 1_001);
    expect(api.autonomousSpeak).toHaveBeenCalledTimes(1);
    resolveFirst();
    await Promise.all([p1, p2]);
    expect(api.autonomousSpeak).toHaveBeenCalledTimes(1);
  });
});
