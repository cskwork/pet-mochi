/**
 * Pet appearance tables (Settings → Appearance). Data only — no DOM — so the
 * tables are unit-testable. Values mirror the backend's PET_SKINS /
 * PET_ACCESSORIES in src-tauri/src/models.rs; unknown values fall back to
 * "classic" / "none" the same way the backend normalizers do.
 */
import type { MovementState } from "../sim/state";

export const PET_SKINS = ["classic", "peach", "matcha", "sky", "lavender", "cocoa"] as const;
export type PetSkin = (typeof PET_SKINS)[number];

export const PET_ACCESSORIES = ["none", "bow", "flower", "crown", "tophat", "cap"] as const;
export type PetAccessory = (typeof PET_ACCESSORIES)[number];

/** Base pet size in logical px at petScale 1. */
export const BASE_PET_SIZE = 140;

export function petSizeFor(scale: number): number {
  const s = Number.isFinite(scale) ? Math.min(1.5, Math.max(0.75, scale)) : 1;
  return Math.round(BASE_PET_SIZE * s);
}

/**
 * Skin tint, applied on a wrapper around the sprite so it composes with the
 * per-mood `--mood-filter` on the <img>. The base art is near-white, and
 * sepia/hue-rotate alone barely move white, so each recipe first dims a
 * little (gives sepia something to tint), then sepia → saturate → hue-rotate
 * to the target hue, then brightens back. Black stays black (eyes stay dark);
 * the blush shifts with the hue but stays the most saturated patch.
 */
export const SKIN_FILTERS: Record<PetSkin, string> = {
  classic: "none",
  peach: "brightness(0.9) sepia(0.5) saturate(2.2) hue-rotate(-45deg) brightness(1.08)",
  matcha: "brightness(0.88) sepia(0.6) saturate(1.6) hue-rotate(45deg) brightness(1.06)",
  sky: "brightness(0.88) sepia(0.6) saturate(1.6) hue-rotate(150deg) brightness(1.08)",
  lavender: "brightness(0.86) sepia(0.7) saturate(2.2) hue-rotate(220deg) brightness(1.08)",
  cocoa: "brightness(0.62) sepia(0.9) saturate(1) hue-rotate(-15deg) brightness(1.05)",
};

/** Swatch colors for the Settings picker (approximate the filtered body). */
export const SKIN_SWATCHES: Record<PetSkin, string> = {
  classic: "#fdeff1",
  peach: "#ffd2b8",
  matcha: "#d7e9b4",
  sky: "#c6e3f7",
  lavender: "#ddd0f3",
  cocoa: "#c49a7c",
};

export const SKIN_LABELS: Record<PetSkin, string> = {
  classic: "Classic",
  peach: "Peach",
  matcha: "Matcha",
  sky: "Sky",
  lavender: "Lavender",
  cocoa: "Cocoa",
};

export const ACCESSORY_LABELS: Record<PetAccessory, string> = {
  none: "None",
  bow: "🎀 Bow",
  flower: "🌸 Flower",
  crown: "👑 Crown",
  tophat: "🎩 Top hat",
  cap: "🧢 Cap",
};

/** Per-accessory glyph and offset from the head anchor (fractions of size). */
export const ACCESSORY_STYLE: Record<
  Exclude<PetAccessory, "none">,
  { glyph: string; dx: number; dy: number; rot: number; size: number }
> = {
  bow: { glyph: "🎀", dx: 0.13, dy: 0.01, rot: 15, size: 0.19 },
  flower: { glyph: "🌸", dx: -0.13, dy: 0.02, rot: -12, size: 0.17 },
  crown: { glyph: "👑", dx: 0, dy: -0.05, rot: 0, size: 0.2 },
  tophat: { glyph: "🎩", dx: 0, dy: -0.07, rot: 0, size: 0.22 },
  cap: { glyph: "🧢", dx: 0, dy: -0.04, rot: -8, size: 0.2 },
};

/** Head-top anchor (between the ears) per pose, measured from the sprite
 *  alpha; null hides the accessory (lying down, curled up, half off-frame). */
export type HeadAnchor = { x: number; y: number; rot?: number } | null;

export const HEAD_ANCHORS: Record<MovementState, HeadAnchor> = {
  idle: { x: 0.5, y: 0.21 },
  walk: { x: 0.52, y: 0.23, rot: 4 },
  run: { x: 0.6, y: 0.3, rot: 12 },
  sleep: null,
  jump: { x: 0.5, y: 0.2 },
  sit: { x: 0.5, y: 0.29 },
  look_cursor: { x: 0.53, y: 0.22, rot: 6 },
  hide: null,
  celebrate: { x: 0.47, y: 0.26 },
  eat: { x: 0.5, y: 0.2 },
  eat_2: { x: 0.5, y: 0.2 },
  yawn: { x: 0.5, y: 0.2 },
  roll: null,
  blush: { x: 0.5, y: 0.21 },
  stretch: { x: 0.5, y: 0.14 },
  peek: null,
  tilt_head: { x: 0.6, y: 0.2, rot: 18 },
  shake: { x: 0.5, y: 0.22 },
  nuzzle: { x: 0.43, y: 0.24, rot: -10 },
  wiggle: { x: 0.55, y: 0.21, rot: 8 },
  dizzy: { x: 0.5, y: 0.3 },
  surprise: { x: 0.5, y: 0.22 },
  eat_strawberry: { x: 0.5, y: 0.2 },
  eat_strawberry_2: { x: 0.5, y: 0.2 },
  eat_cookie: { x: 0.5, y: 0.2 },
  eat_cookie_2: { x: 0.5, y: 0.2 },
};

export function normalizeSkin(v: string | null | undefined): PetSkin {
  return (PET_SKINS as readonly string[]).includes(v ?? "") ? (v as PetSkin) : "classic";
}

export function normalizeAccessory(v: string | null | undefined): PetAccessory {
  return (PET_ACCESSORIES as readonly string[]).includes(v ?? "") ? (v as PetAccessory) : "none";
}

/** Final placement for an accessory in a pose, or null when hidden. */
export function accessoryPlacement(
  accessory: string | null | undefined,
  animation: MovementState,
): { glyph: string; x: number; y: number; rot: number; size: number } | null {
  const acc = normalizeAccessory(accessory);
  if (acc === "none") return null;
  const anchor = HEAD_ANCHORS[animation];
  if (!anchor) return null;
  const st = ACCESSORY_STYLE[acc];
  return {
    glyph: st.glyph,
    x: anchor.x + st.dx,
    y: anchor.y + st.dy,
    rot: (anchor.rot ?? 0) + st.rot,
    size: st.size,
  };
}
