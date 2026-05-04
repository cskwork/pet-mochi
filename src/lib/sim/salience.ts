import type { PetState } from "./state";

export type PetEvent =
  | { type: "APP_STARTED" }
  | { type: "APP_CLOSING" }
  | { type: "USER_CLICKED_PET" }
  | { type: "USER_HOVERED_PET" }
  | { type: "USER_SENT_MESSAGE"; text: string }
  | { type: "USER_RETURNED"; awayMinutes: number }
  | { type: "IDLE_TICK" }
  | {
      type: "TIME_OF_DAY_CHANGED";
      period: "morning" | "afternoon" | "evening" | "night";
    }
  | { type: "FILE_FOUND_IN_INBOX"; path: string }
  | { type: "FILE_INSPECTION_APPROVED"; path: string }
  | { type: "MEMORY_CREATED"; memoryId: string }
  | { type: "LLM_RESPONSE_READY"; requestId: string; text: string }
  | { type: "STATUS_REPORT_DUE" };  // §9.8 idle-triggered, fires every ~12h

export function eventImportance(event: PetEvent): number {
  switch (event.type) {
    case "APP_STARTED":
      return 60;
    case "APP_CLOSING":
      return 50;
    case "USER_SENT_MESSAGE":
      return 90;
    case "USER_RETURNED":
      return event.awayMinutes >= 30 ? 70 : 30;
    case "USER_CLICKED_PET":
      return 20;
    case "USER_HOVERED_PET":
      return 5;
    case "FILE_FOUND_IN_INBOX":
      return 55;
    case "FILE_INSPECTION_APPROVED":
      return 70;
    case "MEMORY_CREATED":
      return 40;
    case "STATUS_REPORT_DUE":
      return 80;
    case "LLM_RESPONSE_READY":
      return 10;
    case "TIME_OF_DAY_CHANGED":
      return 25;
    case "IDLE_TICK":
      return 1;
  }
}

export function moodUrgency(state: PetState): number {
  let n = 0;
  if (state.energy < 15) n += 10;
  if (state.hunger > 80) n += 8;
  if (state.boredom > 80) n += 8;
  if (state.affection < 15) n += 12;
  return n;
}

export function relationshipWeight(state: PetState): number {
  return Math.min(20, state.relationshipLevel * 5);
}

/**
 * Tracks per-key cooldowns. `pass(key, ms)` returns true and stamps the key
 * if `ms` milliseconds have elapsed since the last successful pass; otherwise
 * returns false without updating. `reset()` clears all tracked keys.
 */
export class CooldownTracker {
  private cooldowns: Record<string, number> = {};

  pass(key: string, ms: number): boolean {
    const now = Date.now();
    const last = this.cooldowns[key] ?? 0;
    if (now - last < ms) return false;
    this.cooldowns[key] = now;
    return true;
  }

  reset(): void {
    this.cooldowns = {};
  }
}

/** Default singleton, used by the module-level helpers below. */
export const defaultCooldowns = new CooldownTracker();

export function cooldownPassed(key: string, ms: number): boolean {
  return defaultCooldowns.pass(key, ms);
}

/** Reset all cooldowns — used in tests. */
export function _resetCooldowns(): void {
  defaultCooldowns.reset();
}

const DEFAULT_AUTO_LLM_COOLDOWN = 90_000;
const SALIENCE_THRESHOLD = 70;

/**
 * Decide whether an event is salient enough to trigger an autonomous LLM call.
 * Direct user messages always pass — they bypass the salience score.
 */
export function shouldCallLLM(event: PetEvent, state: PetState): boolean {
  if (event.type === "USER_SENT_MESSAGE") return true;
  const score =
    eventImportance(event) + moodUrgency(state) + relationshipWeight(state);
  return (
    score >= SALIENCE_THRESHOLD &&
    defaultCooldowns.pass("llm_autonomous", DEFAULT_AUTO_LLM_COOLDOWN)
  );
}
