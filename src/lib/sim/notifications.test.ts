import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_RULES,
  newNotificationGate,
  notificationCandidate,
  notificationCopy,
  recordNotification,
  shouldNotify,
  type NotificationKind,
} from "./notifications";
import { newPetState } from "./state";

const MIN = 60_000;
const T0 = Date.parse("2026-05-03T12:00:00Z");

describe("REQ-122 notificationCandidate — thresholds (first match wins)", () => {
  it("returns null for a comfortable pet", () => {
    expect(notificationCandidate(newPetState())).toBeNull();
  });

  it("hunger above 85 → critical_hunger (85 itself is not critical)", () => {
    expect(notificationCandidate({ ...newPetState(), hunger: 85 })).toBeNull();
    expect(notificationCandidate({ ...newPetState(), hunger: 86 })).toBe(
      "critical_hunger",
    );
  });

  it("energy below 12 → critical_energy (12 itself is not critical)", () => {
    expect(notificationCandidate({ ...newPetState(), energy: 12 })).toBeNull();
    expect(notificationCandidate({ ...newPetState(), energy: 11 })).toBe(
      "critical_energy",
    );
  });

  it("stress above 80 → critical_stress (80 itself is not critical)", () => {
    expect(notificationCandidate({ ...newPetState(), stress: 80 })).toBeNull();
    expect(notificationCandidate({ ...newPetState(), stress: 81 })).toBe(
      "critical_stress",
    );
  });

  it("hunger outranks energy and stress; energy outranks stress", () => {
    expect(
      notificationCandidate({
        ...newPetState(),
        hunger: 90,
        energy: 5,
        stress: 95,
      }),
    ).toBe("critical_hunger");
    expect(
      notificationCandidate({ ...newPetState(), energy: 5, stress: 95 }),
    ).toBe("critical_energy");
  });
});

describe("REQ-122 shouldNotify — suppression rules + cooldown math", () => {
  it("allows a first notification once past the boot grace", () => {
    const gate = newNotificationGate();
    expect(
      shouldNotify("critical_hunger", gate, T0, {
        uptimeMs: 10 * MIN,
        settingsFocused: false,
      }),
    ).toBe(true);
  });

  it("suppresses during the first 10 minutes after launch", () => {
    const gate = newNotificationGate();
    expect(
      shouldNotify("critical_hunger", gate, T0, {
        uptimeMs: 10 * MIN - 1,
        settingsFocused: false,
      }),
    ).toBe(false);
  });

  it("suppresses while the settings window is focused", () => {
    const gate = newNotificationGate();
    expect(
      shouldNotify("critical_hunger", gate, T0, {
        uptimeMs: 60 * MIN,
        settingsFocused: true,
      }),
    ).toBe(false);
  });

  it("per-kind cooldown blocks for 60 minutes, then expires", () => {
    // critical_hunger fired 59m59s ago (and was also the last of any kind).
    const gate = recordNotification(
      newNotificationGate(),
      "critical_hunger",
      T0 - (60 * MIN - 1_000),
    );
    expect(
      shouldNotify("critical_hunger", gate, T0, {
        uptimeMs: 60 * MIN,
        settingsFocused: false,
      }),
    ).toBe(false);
    // At exactly 60 minutes both the per-kind and the shorter global
    // cooldown have elapsed → allowed again.
    const gate60 = recordNotification(
      newNotificationGate(),
      "critical_hunger",
      T0 - 60 * MIN,
    );
    expect(
      shouldNotify("critical_hunger", gate60, T0, {
        uptimeMs: 61 * MIN,
        settingsFocused: false,
      }),
    ).toBe(true);
  });

  it("global 30-minute cooldown spans kinds", () => {
    // critical_energy fired 10 minutes ago; a critical_hunger candidate now
    // is still suppressed by the global cooldown…
    const gate = recordNotification(
      newNotificationGate(),
      "critical_energy",
      T0 - 10 * MIN,
    );
    expect(
      shouldNotify("critical_hunger", gate, T0, {
        uptimeMs: 60 * MIN,
        settingsFocused: false,
      }),
    ).toBe(false);
    // …until 30 minutes have passed (energy's own 60m cooldown is separate).
    const gate30 = recordNotification(
      newNotificationGate(),
      "critical_energy",
      T0 - 30 * MIN,
    );
    expect(
      shouldNotify("critical_hunger", gate30, T0, {
        uptimeMs: 60 * MIN,
        settingsFocused: false,
      }),
    ).toBe(true);
  });
});

describe("REQ-122 recordNotification — pure stamp bookkeeping", () => {
  it("stamps the fired kind and lastAny without touching other kinds", () => {
    const before = recordNotification(
      newNotificationGate(),
      "critical_energy",
      T0 - 10 * MIN,
    );
    const after = recordNotification(before, "critical_stress", T0);
    expect(after.lastByKind.critical_stress).toBe(T0);
    expect(after.lastByKind.critical_energy).toBe(T0 - 10 * MIN);
    expect(after.lastByKind.critical_hunger).toBeNull();
    expect(after.lastAny).toBe(T0);
  });

  it("does not mutate the input gate", () => {
    const before = newNotificationGate();
    recordNotification(before, "critical_hunger", T0);
    expect(before.lastByKind.critical_hunger).toBeNull();
    expect(before.lastAny).toBeNull();
  });

  it("exports the cooldown constants the PRD amendment specifies", () => {
    expect(NOTIFICATION_RULES.BOOT_GRACE_MS).toBe(10 * MIN);
    expect(NOTIFICATION_RULES.GLOBAL_COOLDOWN_MS).toBe(30 * MIN);
    expect(NOTIFICATION_RULES.PER_KIND_COOLDOWN_MS).toBe(60 * MIN);
  });
});

describe("REQ-122 notificationCopy — kind copy, zero guilt", () => {
  const KINDS: NotificationKind[] = [
    "critical_hunger",
    "critical_energy",
    "critical_stress",
  ];
  // Mirror of the REQ-108 forbidden-vocabulary test: the copy must inform,
  // never guilt. Checked case-insensitively over title and body.
  const FORBIDDEN = [
    /finally/i,
    /you left me/i,
    /why did you/i,
    /starving/i,
    /neglect/i,
    /ignored/i,
  ];

  it("mentions the pet's name in every title", () => {
    for (const kind of KINDS) {
      const copy = notificationCopy(kind, "Mochi");
      expect(copy.title).toContain("Mochi");
      expect(copy.body.length).toBeGreaterThan(0);
    }
  });

  it("contains no forbidden phrase in any title or body", () => {
    for (const kind of KINDS) {
      const { title, body } = notificationCopy(kind, "Mochi");
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(title), `${kind} title "${title}" vs ${pattern}`).toBe(false);
        expect(pattern.test(body), `${kind} body "${body}" vs ${pattern}`).toBe(false);
      }
    }
  });
});
