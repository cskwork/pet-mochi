/**
 * REQ-124.2 — gifts composable extracted from Pet.svelte (pure move).
 * REQ-109 keepsakes + REQ-110 hatch-day: owns the mutable runtime flags and
 * stamps (the pure evaluators stay in sim/keepsakes.ts + sim/hatchday.ts) and
 * performs the memory writes plus celebration callbacks. Both gates hinge on
 * the restored memory list so a restart can never duplicate a gift or a
 * yearly celebration.
 */
import { playSfx } from "../audio/sfx";
import { api } from "../bridge/api";
import {
  canLeaveKeepsake,
  pickTrinket,
  keepsakeMemoryContent,
  keepsakeBubble,
  lastKeepsakeAt,
  KEEPSAKE_MEMORY_TYPE,
  hatchdayStatus,
  hasCelebratedHatchdayThisYear,
  hatchdayMemoryContent,
  hatchdayBubble,
  HATCHDAY_MEMORY_TYPE,
  CHOREOGRAPHY_CATALOG,
  type AnimationStep,
  type ParticleKind,
  type PetState,
} from "../sim";

/** Keepsake gate cadence (REQ-109). */
const KEEPSAKE_CHECK_MS = 10 * 60_000;

/** Memory rows the restore path needs (structural — api.Memory satisfies it). */
export type MemoryLike = readonly {
  type: string;
  content: string;
  createdAt: string;
}[];

/** Celebrations drive Pet-owned animation/particle/bubble channels. */
export type GiftEffects = {
  playSteps: (steps: AnimationStep[]) => void;
  spawnBurst: (kind: ParticleKind) => void;
  flashBubble: (text: string, ms?: number) => void;
};

/** Reads the live animation deadline at evaluation time (it can move while a
 *  memory write is in flight — REQ-109 re-checks after the await). */
export type ActionPlayingUntil = () => number;

export function createGifts(effects: GiftEffects) {
  let memoriesRestored = false;
  let lastKeepsakeAtIso: string | null = null;
  let lastKeepsakeCheckAt = 0;
  let hatchdayCelebratedYearly = false;
  let monthlyHeartsCelebrated = false;
  let lastDayStamp = "";

  /** Mount-time restore from durable memories (restart path). */
  function restore(memories: MemoryLike): void {
    lastKeepsakeAtIso = lastKeepsakeAt(memories);
    hatchdayCelebratedYearly = hasCelebratedHatchdayThisYear(memories, new Date());
    memoriesRestored = true;
  }

  /** Seed the day stamp at mount so the first tick isn't mistaken for a
   *  mid-session rollover (REQ-110). */
  function primeDayStamp(now: number): void {
    lastDayStamp = new Date(now).toDateString();
  }

  /** REQ-110 — a day rollover mid-session re-checks the hatch-day and
   *  re-arms the once-per-session monthly hearts. */
  function onDayRollover(now: number, pet: PetState): void {
    const dayStamp = new Date(now).toDateString();
    if (dayStamp !== lastDayStamp) {
      const rolled = lastDayStamp !== "";
      lastDayStamp = dayStamp;
      if (rolled) {
        monthlyHeartsCelebrated = false;
        maybeCelebrateHatchday(pet, now);
      }
    }
  }

  /** REQ-109 — cadence half of the keepsake gate; stamps the check even when
   *  the inner gate declines, so evaluation happens at most every 10 min. */
  function keepsakeDue(
    pet: PetState,
    now: number,
    actionPlayingUntil: ActionPlayingUntil,
  ): boolean {
    if (!api.hasBackend || !memoriesRestored) return false;
    if (now - lastKeepsakeCheckAt < KEEPSAKE_CHECK_MS) return false;
    lastKeepsakeCheckAt = now;
    return now >= actionPlayingUntil() && canLeaveKeepsake(pet, lastKeepsakeAtIso, now);
  }

  /** REQ-109 — write the keepsake memory, then celebrate. The stamp rolls
   *  back on a failed write so the 10-minute check retries. */
  async function leaveKeepsake(
    pet: PetState,
    now: number,
    actionPlayingUntil: ActionPlayingUntil,
  ): Promise<void> {
    const prior = lastKeepsakeAtIso;
    const nowIso = new Date(now).toISOString();
    lastKeepsakeAtIso = nowIso;
    try {
      const trinket = pickTrinket(pet.id, nowIso);
      await api.createMemory({
        type: KEEPSAKE_MEMORY_TYPE,
        content: keepsakeMemoryContent(trinket),
        importance: 2,
        confidence: 1,
      });
      // Re-check after the await — an action the user started while the
      // write was in flight shouldn't be stomped by the gift choreography.
      if (Date.now() >= actionPlayingUntil()) {
        effects.playSteps(CHOREOGRAPHY_CATALOG.delight_burst.variants[0]);
      }
      effects.spawnBurst("confetti");
      playSfx("sparkle");
      effects.flashBubble(keepsakeBubble(pet.name, trinket), 5_000);
    } catch {
      // Backend hiccup — roll back the stamp so the 10-minute check retries.
      lastKeepsakeAtIso = prior;
    }
  }

  /** REQ-110 — yearly hatch-day (memory + full celebration) or the lighter
   *  once-per-session monthly hearts. */
  function maybeCelebrateHatchday(pet: PetState, now: number): void {
    const today = new Date(now);
    const status = hatchdayStatus(pet.createdAt, today);
    if (status.yearly && !hatchdayCelebratedYearly && api.hasBackend && memoriesRestored) {
      hatchdayCelebratedYearly = true;
      void (async () => {
        await api
          .createMemory({
            type: HATCHDAY_MEMORY_TYPE,
            content: hatchdayMemoryContent(status.ageYears),
            importance: 3,
            confidence: 1,
          })
          .catch(() => undefined);
        effects.playSteps(CHOREOGRAPHY_CATALOG.delight_burst.variants[0]);
        effects.spawnBurst("confetti");
        playSfx("chime");
        effects.flashBubble(hatchdayBubble(pet.name, status.ageYears), 6_000);
      })();
    } else if (status.monthly && !monthlyHeartsCelebrated) {
      monthlyHeartsCelebrated = true;
      effects.spawnBurst("hearts");
    }
  }

  return {
    restore,
    primeDayStamp,
    onDayRollover,
    keepsakeDue,
    leaveKeepsake,
    maybeCelebrateHatchday,
  };
}
