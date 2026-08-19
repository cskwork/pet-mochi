import { describe, expect, it } from "vitest";
import {
  MAX_NOTE_GAIN,
  MAX_SFX_MS,
  sfxNotes,
  type SfxKind,
} from "./sfx";

const KINDS: SfxKind[] = [
  "boop",
  "nom",
  "bounce",
  "settle",
  "sparkle",
  "chime",
  "pop",
];

describe("REQ-117 sound-effect note tables", () => {
  it("every kind has at least one note", () => {
    for (const kind of KINDS) {
      expect(sfxNotes(kind).length, kind).toBeGreaterThan(0);
    }
  });

  it("stays a chirp: every note gain is tiny and durations are short", () => {
    for (const kind of KINDS) {
      for (const note of sfxNotes(kind)) {
        expect(note.gain, kind).toBeLessThanOrEqual(MAX_NOTE_GAIN);
        expect(note.gain, kind).toBeGreaterThan(0);
        expect(note.durMs, kind).toBeGreaterThan(0);
        expect(note.startMs, kind).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("no effect outlasts the animation beat it accompanies", () => {
    for (const kind of KINDS) {
      const total = Math.max(
        ...sfxNotes(kind).map((n) => n.startMs + n.durMs),
      );
      expect(total, kind).toBeLessThanOrEqual(MAX_SFX_MS);
    }
  });

  it("frequencies stay in a soft, non-piercing band", () => {
    for (const kind of KINDS) {
      for (const note of sfxNotes(kind)) {
        expect(note.freqHz, kind).toBeGreaterThanOrEqual(150);
        expect(note.freqHz, kind).toBeLessThanOrEqual(1200);
      }
    }
  });

  it("is deterministic", () => {
    expect(sfxNotes("sparkle")).toEqual(sfxNotes("sparkle"));
  });
});
