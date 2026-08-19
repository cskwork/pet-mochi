/**
 * Particle burst specs (PRD §27.4, REQ-105).
 *
 * Pure spec generation only — the DOM/CSS lives in Pet.svelte. Keeping the
 * numbers here makes counts, ranges, and intensity scaling unit-testable and
 * guarantees the renderer stays a dumb consumer.
 */

export type ParticleKind =
  | "hearts"
  | "hearts_big"
  | "crumbs"
  | "confetti"
  | "sleep";

export type ParticleSpec = {
  glyph: string;
  /** Horizontal drift in px over the particle's life; negative = left. */
  dx: number;
  /** Vertical rise in px (particles float upward). */
  rise: number;
  /** Start delay in ms so a burst doesn't pop as one rigid block. */
  delayMs: number;
  /** Float-and-fade duration in ms. */
  durationMs: number;
  /** Font size in px. */
  sizePx: number;
  /** Index into the kind's color palette (renderer maps to a CSS class). */
  colorIndex: number;
};

/** Hard cap on simultaneously live particle DOM nodes (REQ-105). */
export const MAX_LIVE_PARTICLES = 12;

const KIND_GLYPHS: Record<ParticleKind, readonly string[]> = {
  hearts: ["♥", "♡"],
  hearts_big: ["♥", "♡", "♥"],
  crumbs: ["·", "✦", "·"],
  confetti: ["●", "▲", "■", "✦"],
  sleep: ["z", "Z"],
};

const KIND_BASE_COUNT: Record<ParticleKind, number> = {
  hearts: 4,
  hearts_big: 7,
  crumbs: 5,
  confetti: 8,
  sleep: 3,
};

/** Number of palette entries the renderer defines per kind. */
export const PARTICLE_COLOR_VARIANTS = 4;

const DX_MAX = 28;
const RISE_MIN = 36;
const RISE_MAX = 64;
const DELAY_MAX_MS = 240;
const DURATION_MIN_MS = 900;
const DURATION_MAX_MS = 1400;
const SIZE_MIN_PX = 10;
const SIZE_MAX_PX = 18;

const lerp = (lo: number, hi: number, t: number): number => lo + (hi - lo) * t;

/**
 * Build the specs for one burst. Deterministic under an injected `rng`.
 * `intensity` mirrors the `animationIntensity` setting (REQ-113): counts scale
 * linearly, `<= 0` produces no particles, and a single burst never exceeds
 * {@link MAX_LIVE_PARTICLES}.
 */
export function particleSpecsFor(
  kind: ParticleKind,
  rng: () => number = Math.random,
  intensity = 1,
): ParticleSpec[] {
  if (intensity <= 0) return [];
  const count = Math.min(
    MAX_LIVE_PARTICLES,
    Math.round(KIND_BASE_COUNT[kind] * Math.min(1.5, intensity)),
  );
  const glyphs = KIND_GLYPHS[kind];
  const specs: ParticleSpec[] = [];
  for (let i = 0; i < count; i++) {
    specs.push({
      glyph: glyphs[i % glyphs.length],
      dx: Math.round(lerp(-DX_MAX, DX_MAX, rng())),
      rise: Math.round(lerp(RISE_MIN, RISE_MAX, rng())),
      delayMs: Math.round(rng() * DELAY_MAX_MS),
      durationMs: Math.round(lerp(DURATION_MIN_MS, DURATION_MAX_MS, rng())),
      sizePx: Math.round(lerp(SIZE_MIN_PX, SIZE_MAX_PX, rng())),
      colorIndex: Math.min(
        PARTICLE_COLOR_VARIANTS - 1,
        Math.floor(rng() * PARTICLE_COLOR_VARIANTS),
      ),
    });
  }
  return specs;
}

/** Exposed for tests so the renderer CSS and the spec ranges stay in lockstep. */
export const PARTICLE_SPEC_RANGES = {
  DX_MAX,
  RISE_MIN,
  RISE_MAX,
  DELAY_MAX_MS,
  DURATION_MIN_MS,
  DURATION_MAX_MS,
  SIZE_MIN_PX,
  SIZE_MAX_PX,
} as const;
