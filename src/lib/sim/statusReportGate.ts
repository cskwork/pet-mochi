import type { MovementState } from "./state";

/**
 * Pure-function gate for the §9.8 idle-triggered status report.
 *
 * Returns `true` when ALL of the following hold (REQ-070..074):
 *
 * 1. **Cadence:** at least 12 hours have elapsed since the last report
 *    (or, on first run, since the pet was created).
 * 2. **Idle window:** the pet is currently in `idle` or `sleep`, and has
 *    been so for at least 60 000 ms.
 * 3. **No in-flight action:** an action animation sequence (feed/play/etc.)
 *    is not mid-playback.
 *
 * The function is stateless. Callers MUST update `pet.lastReportAt` after a
 * successful report so the gate cooldown advances — otherwise it will keep
 * firing on every tick (REQ-074: no catch-up means exactly one fire per
 * 12h boundary, not a backlog).
 */
export type StatusReportGateInput = {
  /** `Date.now()` at the moment of evaluation. */
  now: number;
  /** Persisted RFC3339 timestamp; null on first run. */
  lastReportAt: string | null;
  /** Fallback baseline when `lastReportAt` is null — usually `pet.createdAt`. */
  createdAt: string;
  /** Current `MovementState` (string-equal to a literal in the union). */
  currentAnimation: MovementState;
  /** `Date.now()` at the moment the pet entered the current idle stretch. */
  idleSince: number;
  /** True while a multi-step action animation is mid-playback. */
  inFlight: boolean;
};

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const IDLE_DWELL_MS = 60_000;
const IDLE_STATES: ReadonlySet<MovementState> = new Set<MovementState>([
  "idle",
  "sleep",
]);

export function shouldFireStatusReport(input: StatusReportGateInput): boolean {
  if (input.inFlight) return false;
  if (!IDLE_STATES.has(input.currentAnimation)) return false;
  if (input.now - input.idleSince < IDLE_DWELL_MS) return false;

  const baselineIso = input.lastReportAt ?? input.createdAt;
  const baselineMs = Date.parse(baselineIso);
  if (Number.isNaN(baselineMs)) {
    // Unparseable timestamp — treat as "never". Don't fire to avoid spam
    // from a broken state; the next save_pet_state will rewrite a clean
    // RFC3339 value and the gate will resume.
    return false;
  }
  return input.now - baselineMs >= TWELVE_HOURS_MS;
}

/** Exposed for tests so the constants stay in lockstep. */
export const STATUS_REPORT_GATE_CONSTANTS = {
  TWELVE_HOURS_MS,
  IDLE_DWELL_MS,
  IDLE_STATES,
} as const;
