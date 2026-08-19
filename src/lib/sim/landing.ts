import type { AnimationStep } from "./actions";
import type { MovementState } from "./state";

/**
 * Drag dangle & landing (PRD §27.6, REQ-112).
 *
 * While the OS drags the overlay window the pet dangles in a "grabbed" pose;
 * when the window stops moving, a landing beat plays. Detection piggybacks on
 * the existing 80ms hit-test poll — this module only owns the pure decisions.
 */

/** Pose shown while the window drag is in progress. */
export const GRAB_ANIMATION: MovementState = "surprise";

/** Displacement (logical px) beyond which the landing adds a dizzy beat. */
export const BIG_DROP_PX = 200;

/** Consecutive stable position samples (80ms apart) that count as "landed".
 *  4 samples (~320ms of stillness) keeps a brief mid-drag pause from reading
 *  as a drop while still feeling instant on release. */
export const LANDING_STABLE_SAMPLES = 4;

/**
 * Steps to play once the drop is detected. Small moves settle straight back
 * to idle (the CSS squash-bounce carries the impact); big moves wobble first.
 */
export function landingSteps(distancePx: number): AnimationStep[] {
  if (distancePx >= BIG_DROP_PX) {
    return [
      { animation: "dizzy", durationMs: 700 },
      { animation: "shake", durationMs: 420 },
      { animation: "idle", durationMs: 250 },
    ];
  }
  return [{ animation: "idle", durationMs: 250 }];
}
