# Design — Landing Page (`docs/index.html`)

<!-- impeccable:design-schema 1 -->

Recorded after the build, from the shipped file. Ground truth over intention.
Seed key `0c678df3` · direction **The Device** (dealt index 5, code-led) ·
reviewer pass: vision-verified captures in `.impeccable/review/` (desktop,
desktop-ko, mobile, mobile-ko), one `fix` round applied.

## Product Truth

See `PRODUCT.md`. Platform: web (marketing landing only). The product itself
is the Tauri desktop pet; the page must never imply cloud dependency,
packaged installers, or unshipped features.

## Visual World — "The Device"

The landing is the toy itself. An oversized, working Mochi device sits at the
hero's center running a faithful port of `src/lib/sim` (decay, mood,
movement, action beats — real constants, thresholds, bubbles). The page is
the app's own visual system scaled up, not a new one.

## Tokens

| Role | Value | Source |
|---|---|---|
| Page ground | `linear-gradient(160deg, #fffdf7, #fff1e0)` | app stage "cream" |
| Device screen | `linear-gradient(160deg, #fff5f8, #ffdfeb)` | app stage "blossom" |
| Sandbox panel | `linear-gradient(160deg, #2c2440, #1c1730)` | app stage "night" |
| Ink / secondary | `#3a2b34` / `#6a5560` / `#95808c` | app `--mochi-text` family |
| Accent | `#ff7aa1` (fills) · `#b34a6e` (text-safe 4.6:1 on cream) | app accent |
| Stat bars | `#6dc28a` / `#f5b955` / `#e57373` at <25 / <45 thresholds | `PetStatus.svelte` |
| Mood tints | happy `#ffe3ea` · curious `#fff1d6` · tired `#e8dcea` · hungry `#ffe0cc` · bored `#e2e8ee` · lonely `#d9d2ea` | `ChatBubble.svelte` |
| Mood sprite filters | hue-rotate/saturate per mood | `MochiSprite.svelte` `MOOD_FILTER` |
| Radius | 16px cards · 40px device shell · 24px screen · 12px pose cells | app 18px card language, scaled |
| Shadows | offset + soft blur only (no zero-offset halos, no hard offset blocks) | craft floor |

## Type

- Display: **Baloo 2** 600/700/800 (Google Fonts, swap) — rounded toy voice;
  falls back to ui-rounded stacks incl. Apple SD Gothic Neo / Noto Sans KR.
- Body: ui-rounded system stack (same KO fallbacks).
- Mono: ui-monospace/SF Mono — terminal, stat labels, predicates, stock
  codes only (never as costume).
- Scale: h1 clamp(2.1–3rem) · h2 clamp(1.7–2.4rem) · tracking floor −0.03em.

## Components

- **Device**: cream plastic shell (1px warm border + inset top highlight +
  layered drop shadows), blossom-gradient screen with inner tinted shadow,
  dotted speaker strip, chunky bottom-bordered buttons (real emoji icons =
  the app's real `ACTION_DEFINITIONS` icons), dashed meta Report button,
  absolute snack tray (dango/strawberry/cookie, real REQ-116 sprites).
- **HUD**: mood pill (mood tint bg + real glyph) left, 2×2 stat micro-bars
  right, `role="meter"`, width/color by app thresholds.
- **Sprite**: JS-centered absolutely-positioned button; 2-frame cycles at
  app cadence (280ms walk / 160ms run); idle bob / sleep breathe CSS
  keyframes; wander steps like `nextWanderPosition`; mood filter applied to
  the img.
- **Terminal**: ink-dark `#241d2b` panels, pink prompt, working copy
  buttons with clipboard fallback.
- **Ruled lists over cards**: claims, gate rules, sandbox rules, stat rule
  strip, architecture table.
- **Mood grid**: six cells, each showing the *real* idle sprite with that
  mood's CSS filter and the real predicate in mono.
- **Pose catalogue**: edge-to-edge auto-fill grid, 72px thumbs, real
  filenames as stock codes, hover lift.

## Motion

One authored entrance (device settles, 560ms expo-out). Continuous life:
sprite bob/breathe/frame-cycles/wander, bubble pop, particle bursts
(hearts/crumbs/confetti/z) — all suppressed by `prefers-reduced-motion`
(0.01ms pattern from the app's own styles.css). No per-section entrance
animations.

## i18n

EN/KO in one file. `navigator.languages` auto-detect → `ko` when any Korean
locale leads; manual `한국어/EN` toggle persists to `localStorage.mochi-lang`
(auto-detect never persists). EN is snapshotted from the DOM at boot; KO
lives in the `KO` dictionary keyed by `data-i18n` / `data-i18n-attr`.
Runtime strings (bubbles, mood words, pose labels, report, alts) localize
via `t(en, ko)`. Korean copy rules: 해요체, 모치 as the subject (never
그녀), minimal Konglish (쿨다운/살리언스 kept as technical terms with
numbers attached).

## Accessibility

Every control real `<button>` with label/title; tray Esc-closable +
outside-click close; `aria-live` bubble; `aria-expanded` on Feed; meters for
stats; focus-visible 2px pink ring; selection themed; reduced-motion
respected; contrast ≥4.5:1 body (accent text `#b34a6e` on cream).

## Responsive

>1020px: three-column hero (copy / device / claims). ≤1020px: single
column, device first, claims centered ≤520px. ≤560px: nav links hidden
(lang toggle + GitHub remain), 300px screen, 120px sprite, single-column
mood grid, architecture table `display:block; overflow-x:auto`.
Layout padding uses padding-top/bottom on `.hero`/`.nav`/`.close` so
`.wrap`'s side padding survives (shorthand collision found in review).

## Provenance

All rasters in `docs/assets/sprites/` carry `.json` sidecars (embed-prompt
scan: 57/57). Sprites are pre-existing hand-drawn project assets from
`public/sprites/`, converted via cwebp/sips. No AI-generated imagery.

## What this page never does

No kicker/eyebrow labels, no icon-card grids, no section numbers, no
gradient text, no glass decoration, no invented testimonials/users/press,
no download buttons (no installers exist — CTA is clone-and-run), roadmap
labeled as unshipped.
