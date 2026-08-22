/**
 * REQ-124.2 — notify composable extracted from Pet.svelte (pure move).
 * REQ-122 notification gate runtime: the opt-in flag, the gate stamps,
 * bootAt, and the settings-focus suppression flag, plus the tick-path
 * decide+record wrapper. The pure gate in sim/notifications.ts owns every
 * suppression rule; the stamps record even when the OS declines delivery so
 * a denied permission can't re-prompt every tick. Rides the 3s tick — no
 * new timers. Silent per §27.2.2 — the bridge never requests sound/badge.
 */
import { notifyDesktop } from "../bridge/notify";
import {
  newNotificationGate,
  notificationCandidate,
  notificationCopy,
  recordNotification,
  shouldNotify,
  type NotificationGate,
  type PetState,
} from "../sim";

export function createNotify() {
  let enabled = false;
  let gate: NotificationGate = newNotificationGate();
  const bootAt = Date.now();
  // True while the settings window holds focus — the user is already looking
  // at Mochi, so notifications are suppressed (REQ-122).
  let settingsFocused = false;

  /** Opt-in toggle (settings load + live settings:changed events). */
  function setEnabled(v: boolean): void {
    enabled = v;
  }

  /** Settings-window focus tracking (suppression input, REQ-122). */
  function setFocused(v: boolean): void {
    settingsFocused = v;
  }

  /**
   * Tick-path decide+record: fire the OS notification when a need crosses
   * critical and the pure gate allows it. Candidate + verdict come from the
   * pure module; the bridge never throws.
   */
  function evaluate(pet: PetState, now: number): void {
    if (!enabled) return;
    const candidate = notificationCandidate(pet);
    if (candidate === null) return;
    if (
      !shouldNotify(candidate, gate, now, {
        uptimeMs: now - bootAt,
        settingsFocused,
      })
    ) {
      return;
    }
    gate = recordNotification(gate, candidate, now);
    const copy = notificationCopy(candidate, pet.name);
    void notifyDesktop(copy.title, copy.body);
  }

  return { setEnabled, setFocused, evaluate };
}
