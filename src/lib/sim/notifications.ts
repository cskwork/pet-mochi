import type { PetState } from "./state";

/** Critical-need kinds that may raise an opt-in OS notification (REQ-122). */
export type NotificationKind =
  | "critical_hunger"
  | "critical_energy"
  | "critical_stress";

/** Cooldown stamps consulted by `shouldNotify`. Plain data — the caller owns it. */
export type NotificationGate = {
  lastByKind: Record<NotificationKind, number | null>;
  lastAny: number | null;
};

/** Thresholds and cooldowns from the REQ-122 amendment of PRD §27.2. */
export const NOTIFICATION_RULES = {
  /** hunger above this → critical_hunger candidate */
  HUNGER_MAX: 85,
  /** energy below this → critical_energy candidate */
  ENERGY_MIN: 12,
  /** stress above this → critical_stress candidate */
  STRESS_MAX: 80,
  /** no notifications right after launch */
  BOOT_GRACE_MS: 10 * 60_000,
  /** minimum spacing between notifications of any kind */
  GLOBAL_COOLDOWN_MS: 30 * 60_000,
  /** minimum spacing between notifications of the same kind */
  PER_KIND_COOLDOWN_MS: 60 * 60_000,
} as const;

export function newNotificationGate(): NotificationGate {
  return {
    lastByKind: {
      critical_hunger: null,
      critical_energy: null,
      critical_stress: null,
    },
    lastAny: null,
  };
}

/**
 * The first critical need the pet is currently in, or null. First-match order
 * is fixed: hunger, then energy, then stress.
 */
export function notificationCandidate(state: PetState): NotificationKind | null {
  if (state.hunger > NOTIFICATION_RULES.HUNGER_MAX) return "critical_hunger";
  if (state.energy < NOTIFICATION_RULES.ENERGY_MIN) return "critical_energy";
  if (state.stress > NOTIFICATION_RULES.STRESS_MAX) return "critical_stress";
  return null;
}

/**
 * REQ-122 gate: true when a notification of `kind` may be shown at `now`.
 * Suppressed while the user is looking at the settings window, during the
 * first 10 minutes after launch, within 60 minutes of the last notification
 * of the same kind, and within 30 minutes of the last notification of any
 * kind. Pure — returns a verdict, never mutates the gate.
 */
export function shouldNotify(
  kind: NotificationKind,
  gate: NotificationGate,
  now: number,
  opts: { uptimeMs: number; settingsFocused: boolean },
): boolean {
  if (opts.settingsFocused) return false;
  if (opts.uptimeMs < NOTIFICATION_RULES.BOOT_GRACE_MS) return false;
  const lastKind = gate.lastByKind[kind];
  if (
    lastKind !== null &&
    now - lastKind < NOTIFICATION_RULES.PER_KIND_COOLDOWN_MS
  ) {
    return false;
  }
  if (
    gate.lastAny !== null &&
    now - gate.lastAny < NOTIFICATION_RULES.GLOBAL_COOLDOWN_MS
  ) {
    return false;
  }
  return true;
}

/** Record a fired notification. Returns a fresh gate; the input is untouched. */
export function recordNotification(
  gate: NotificationGate,
  kind: NotificationKind,
  now: number,
): NotificationGate {
  return {
    lastByKind: { ...gate.lastByKind, [kind]: now },
    lastAny: now,
  };
}

const COPY: Record<
  NotificationKind,
  (petName: string) => { title: string; body: string }
> = {
  critical_hunger: (petName) => ({
    title: `${petName} is dreaming of snacks`,
    body: "A dango would make her day when you have a moment ♡",
  }),
  critical_energy: (petName) => ({
    title: `${petName} is getting sleepy`,
    body: "Her energy is running low — a cozy nap will recharge her ♡",
  }),
  critical_stress: (petName) => ({
    title: `${petName} is having a quiet moment`,
    body: "Some gentle pats would soothe her whenever you're free ♡",
  }),
};

/**
 * Copy per kind. Kind by design, never guilty — the forbidden-phrase test in
 * notifications.test.ts enforces this the same way REQ-108 guards greetings.
 */
export function notificationCopy(
  kind: NotificationKind,
  petName: string,
): { title: string; body: string } {
  return COPY[kind](petName);
}
