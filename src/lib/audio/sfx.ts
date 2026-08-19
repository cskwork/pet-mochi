/**
 * Synth sound effects (PRD §27.6, REQ-117).
 *
 * No audio assets: every effect is a handful of oscillator notes described by
 * the pure {@link sfxNotes} table (unit-testable in node). Playback rules:
 *
 * - only user-INITIATED moments make sound (pat, feed, play, rest, tray,
 *   discovery, greeting, celebration) — autonomous behaviors (nudges,
 *   quirks, rituals, reports) always stay silent, per the §27.2
 *   quiet-by-default contract;
 * - the master gain is deliberately tiny (chirps, not alerts);
 * - the AudioContext is created lazily on the first play so autoplay
 *   policies (which require a user gesture) are always satisfied;
 * - the settings toggle (`soundEffects`) gates everything via
 *   {@link setSfxEnabled} and follows live `settings:changed` updates.
 */

export type SfxKind =
  | "boop" // pat
  | "nom" // feeding / snack pick
  | "bounce" // play
  | "settle" // rest
  | "sparkle" // favorite discovery, keepsake gift
  | "chime" // welcome-back greeting, hatch-day
  | "pop"; // snack tray open

export type SfxNote = {
  freqHz: number;
  /** Offset from the effect start. */
  startMs: number;
  durMs: number;
  /** Peak gain for this note; kept ≤ MAX_NOTE_GAIN by design. */
  gain: number;
  type: OscillatorType;
};

/** Ceiling any single note may reach — chirps, never alerts. */
export const MAX_NOTE_GAIN = 0.15;

/** Ceiling for a whole effect's length so sounds never trail the animation. */
export const MAX_SFX_MS = 600;

/** Pure note tables — deterministic, no audio API involved. */
export function sfxNotes(kind: SfxKind): SfxNote[] {
  switch (kind) {
    case "boop":
      return [
        { freqHz: 523, startMs: 0, durMs: 70, gain: 0.12, type: "sine" },
        { freqHz: 392, startMs: 70, durMs: 100, gain: 0.1, type: "sine" },
      ];
    case "nom":
      return [
        { freqHz: 220, startMs: 0, durMs: 60, gain: 0.1, type: "triangle" },
        { freqHz: 196, startMs: 115, durMs: 60, gain: 0.09, type: "triangle" },
      ];
    case "bounce":
      return [
        { freqHz: 392, startMs: 0, durMs: 70, gain: 0.1, type: "sine" },
        { freqHz: 523, startMs: 80, durMs: 70, gain: 0.1, type: "sine" },
        { freqHz: 659, startMs: 160, durMs: 110, gain: 0.11, type: "sine" },
      ];
    case "settle":
      return [
        { freqHz: 494, startMs: 0, durMs: 140, gain: 0.08, type: "sine" },
        { freqHz: 330, startMs: 150, durMs: 220, gain: 0.07, type: "sine" },
      ];
    case "sparkle":
      return [
        { freqHz: 659, startMs: 0, durMs: 60, gain: 0.09, type: "sine" },
        { freqHz: 880, startMs: 65, durMs: 60, gain: 0.1, type: "sine" },
        { freqHz: 1047, startMs: 130, durMs: 180, gain: 0.11, type: "sine" },
      ];
    case "chime":
      return [
        { freqHz: 523, startMs: 0, durMs: 150, gain: 0.09, type: "sine" },
        { freqHz: 659, startMs: 120, durMs: 240, gain: 0.09, type: "sine" },
      ];
    case "pop":
      return [{ freqHz: 660, startMs: 0, durMs: 35, gain: 0.06, type: "square" }];
  }
}

let enabled = true;
let ctx: AudioContext | null = null;

/** Settings gate (REQ-117); also flipped live on `settings:changed`. */
export function setSfxEnabled(on: boolean): void {
  enabled = on;
}

export function isSfxEnabled(): boolean {
  return enabled;
}

/**
 * Play an effect. Safe to call anywhere: disabled, unsupported, or suspended
 * audio simply no-ops — sound must never break the pet (PRD §10.2 spirit).
 */
export function playSfx(kind: SfxKind): void {
  if (!enabled) return;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") {
      // Resume is async; schedule against the running clock afterwards.
      void ctx.resume().catch(() => undefined);
    }
    const t0 = ctx.currentTime;
    for (const note of sfxNotes(kind)) {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = note.type;
      osc.frequency.value = note.freqHz;
      const start = t0 + note.startMs / 1000;
      const end = start + note.durMs / 1000;
      // 5ms attack then exponential release — clickless chirp envelope.
      amp.gain.setValueAtTime(0.0001, start);
      amp.gain.linearRampToValueAtTime(note.gain, start + 0.005);
      amp.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(amp).connect(ctx.destination);
      osc.start(start);
      osc.stop(end + 0.02);
    }
  } catch {
    // Audio failures are cosmetic; never surface them.
  }
}

/** Release the audio context (component teardown). */
export function disposeSfx(): void {
  if (ctx) {
    void ctx.close().catch(() => undefined);
    ctx = null;
  }
}
