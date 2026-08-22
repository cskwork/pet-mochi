/**
 * REQ-124.2 — particles composable extracted from Pet.svelte (pure move).
 * REQ-105 live-particle store: spawn/remove honoring MAX_LIVE_PARTICLES.
 * Each live particle snapshots its spawn origin so a wandering pet doesn't
 * drag old hearts along — callers pass the pet's current position at spawn
 * time; this store never tracks pet position itself.
 */
import {
  MAX_LIVE_PARTICLES,
  particleSpecsFor,
  type ParticleKind,
  type ParticleSpec,
} from "../sim";

export type LiveParticle = ParticleSpec & { id: number; x: number; y: number };

export function createParticles() {
  let particles = $state<LiveParticle[]>([]);
  let particleSeq = 0;

  /** Spawn a particle burst at the given origin. Decorative only: skipped
   *  entirely under reduced motion or intensity 0, capped at
   *  MAX_LIVE_PARTICLES concurrent nodes, each node removes itself on
   *  animationend. */
  function spawn(
    kind: ParticleKind,
    origin: { x: number; y: number },
    opts: { reducedMotion: boolean; intensity: number },
  ): void {
    if (opts.reducedMotion) return;
    const specs = particleSpecsFor(kind, Math.random, opts.intensity);
    if (specs.length === 0) return;
    const fresh: LiveParticle[] = specs.map((s) => ({
      ...s,
      id: ++particleSeq,
      x: origin.x,
      y: origin.y,
    }));
    const merged = [...particles, ...fresh];
    particles =
      merged.length > MAX_LIVE_PARTICLES
        ? merged.slice(merged.length - MAX_LIVE_PARTICLES)
        : merged;
  }

  function remove(id: number): void {
    particles = particles.filter((p) => p.id !== id);
  }

  return {
    get list() {
      return particles;
    },
    spawn,
    remove,
  };
}
