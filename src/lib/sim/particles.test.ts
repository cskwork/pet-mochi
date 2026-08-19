import { describe, expect, it } from "vitest";
import {
  MAX_LIVE_PARTICLES,
  PARTICLE_COLOR_VARIANTS,
  PARTICLE_SPEC_RANGES,
  particleSpecsFor,
  type ParticleKind,
} from "./particles";

const KINDS: ParticleKind[] = ["hearts", "hearts_big", "crumbs", "confetti", "sleep"];

const fixedRng = (n: number) => () => n;

// Small LCG so multi-value draws vary but stay deterministic.
function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("REQ-105 particle burst specs", () => {
  it("every kind produces at least one particle at default intensity", () => {
    for (const kind of KINDS) {
      const specs = particleSpecsFor(kind, seededRng(7));
      expect(specs.length, kind).toBeGreaterThan(0);
      expect(specs.length, kind).toBeLessThanOrEqual(MAX_LIVE_PARTICLES);
    }
  });

  it("all spec values stay inside the documented ranges", () => {
    const R = PARTICLE_SPEC_RANGES;
    for (const kind of KINDS) {
      for (const s of particleSpecsFor(kind, seededRng(11))) {
        expect(Math.abs(s.dx)).toBeLessThanOrEqual(R.DX_MAX);
        expect(s.rise).toBeGreaterThanOrEqual(R.RISE_MIN);
        expect(s.rise).toBeLessThanOrEqual(R.RISE_MAX);
        expect(s.delayMs).toBeGreaterThanOrEqual(0);
        expect(s.delayMs).toBeLessThanOrEqual(R.DELAY_MAX_MS);
        expect(s.durationMs).toBeGreaterThanOrEqual(R.DURATION_MIN_MS);
        expect(s.durationMs).toBeLessThanOrEqual(R.DURATION_MAX_MS);
        expect(s.sizePx).toBeGreaterThanOrEqual(R.SIZE_MIN_PX);
        expect(s.sizePx).toBeLessThanOrEqual(R.SIZE_MAX_PX);
        expect(s.colorIndex).toBeGreaterThanOrEqual(0);
        expect(s.colorIndex).toBeLessThan(PARTICLE_COLOR_VARIANTS);
        expect(s.glyph.length).toBeGreaterThan(0);
      }
    }
  });

  it("is deterministic for a fixed rng", () => {
    expect(particleSpecsFor("hearts", seededRng(3))).toEqual(
      particleSpecsFor("hearts", seededRng(3)),
    );
  });
});

describe("REQ-113 intensity scaling of particle counts", () => {
  it("intensity 0 (or below) produces nothing", () => {
    expect(particleSpecsFor("confetti", fixedRng(0.5), 0)).toEqual([]);
    expect(particleSpecsFor("confetti", fixedRng(0.5), -1)).toEqual([]);
  });

  it("half intensity roughly halves the count", () => {
    const full = particleSpecsFor("confetti", fixedRng(0.5), 1).length;
    const half = particleSpecsFor("confetti", fixedRng(0.5), 0.5).length;
    expect(half).toBeLessThan(full);
    expect(half).toBeGreaterThan(0);
  });

  it("a single burst never exceeds the live cap, even at max intensity", () => {
    for (const kind of KINDS) {
      expect(particleSpecsFor(kind, fixedRng(0.5), 1.5).length).toBeLessThanOrEqual(
        MAX_LIVE_PARTICLES,
      );
    }
  });
});
