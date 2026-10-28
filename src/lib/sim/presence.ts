/**
 * User presence (PRD §27.5 welcome-back, REQ-108).
 *
 * "Away" means no real activity anywhere on the desktop (global cursor
 * movement, or any pet interaction) for {@link AWAY_AFTER_MS}. The return is
 * the away→active edge: it fires once, carries the real away duration (so the
 * 120/480-minute greeting tiers are reachable), and `userJustReturned` stays
 * true only for a short burst afterwards. Pure — the caller feeds activity
 * observations and owns the timers; no positions are stored here.
 */

/** No activity for this long → the user is away. Matches the greeting's
 *  WARM_MIN tier boundary. */
export const AWAY_AFTER_MS = 30 * 60_000;

/** How long `userJustReturned` stays true after a return. */
export const RETURN_BURST_MS = 10_000;

export type PresenceState = {
  /** Wall-clock ms of the last observed activity. */
  lastActivityAt: number;
  /** Wall-clock ms of the last away→active edge, or null. */
  returnedAt: number | null;
};

export function newPresence(now: number): PresenceState {
  return { lastActivityAt: now, returnedAt: null };
}

/**
 * Record one activity observation at `now`. Returns the next state plus the
 * away duration in minutes when this observation is the away→active edge
 * (null otherwise).
 */
export function notePresenceActivity(
  p: PresenceState,
  now: number,
): { state: PresenceState; returnedAfterMinutes: number | null } {
  const idleMs = now - p.lastActivityAt;
  if (idleMs >= AWAY_AFTER_MS) {
    return {
      state: { lastActivityAt: now, returnedAt: now },
      returnedAfterMinutes: idleMs / 60_000,
    };
  }
  return { state: { ...p, lastActivityAt: now }, returnedAfterMinutes: null };
}

/** True during the short burst right after a return. */
export function userJustReturned(p: PresenceState, now: number): boolean {
  return p.returnedAt !== null && now - p.returnedAt < RETURN_BURST_MS;
}

/** Minutes since the last activity (0 while active). */
export function minutesSinceActivity(p: PresenceState, now: number): number {
  return Math.max(0, (now - p.lastActivityAt) / 60_000);
}
