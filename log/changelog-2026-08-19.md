# Changelog — 2026-08-19 · v0.2 "The Adorable Update" (PRD §27)

Cuteness & attachment release: research-driven feature set (REQ-100…113),
implemented deterministic-first with the LLM as garnish only. See PRD §27.1
for the research summary and sources.

## Foundation — shipped-but-dormant systems now actually run

- **REQ-103** — added the missing `core:window:allow-set-ignore-cursor-events`
  capability. Audit found every `setIgnoreCursorEvents` call silently failing
  (permission not in `core:window:default`), so click-through never engaged
  and the overlay blocked a 360×360 desktop region (REQ-005 violation).
- **REQ-100** — the 8 expressive poses (`stretch`, `peek`, `tilt_head`,
  `shake`, `nuzzle`, `wiggle`, `dizzy`, `surprise`) now have transform-only
  CSS motion and are covered by the reduced-motion suppression list. They
  previously rendered as static stills.
- **REQ-101** — choreography (§9.11) is reachable at runtime: `APP_STARTED`,
  `FILE_FOUND_IN_INBOX`, and `FILE_INSPECTION_APPROVED` now flow through the
  event bus. Below the LLM salience gate, inbox moments still play the
  deterministic fallback preset (`maybeChoreography(event, useLlm=false)`).
  Boot plays a stretch→wiggle wake-up beat.
- **REQ-102** — the §9.8 status report fires autonomously: the tick tracks
  `idleSince`, evaluates `shouldFireStatusReport`, mirrors the returned
  `windowEnd` into `pet.lastReportAt` (so the debounced save can't roll it
  back), and backs off 10 minutes after a failed attempt.

## Juice

- **REQ-104** — squash-and-stretch: press squish (90ms) + spring-back boing
  (320ms) on the pet anchor, `transform-origin: bottom center`, GPU-only.
- **REQ-105** — particle bursts (hearts / big hearts / crumbs / confetti /
  drifting z's) from a pure spec generator (`sim/particles.ts`): injectable
  RNG, 12-node concurrency cap, self-removing nodes, intensity-scaled,
  fully suppressed under reduced motion.
- **REQ-106** — idle micro-quirks (`sim/quirks.ts`): mood-weighted 1–3 beat
  chains from existing poses, 45s cooldown, 0.3/tick chance × intensity.
  Quirks yield while a status report is due so they can't starve REQ-070's
  60s idle window.

## Care loop

- **REQ-107** — snack tray on Feed (🍓/🍡/🍪) with a hidden per-pet favorite
  (`sim/snacks.ts`, FNV over pet identity). First favorite feed = discovery:
  blush sequence, double hearts, durable `pet_belief` memory; repeats give
  +2 affection. Tray is keyboard-accessible, Escape-closable, hit-test
  registered, 8s auto-close.
- **REQ-108** — tiered welcome-back ritual (`sim/greetings.ts`): 30m–2h warm
  greet, 2h–8h delight + hearts, >8h peek→surprise→celebrate→nuzzle + big
  hearts. Plays instantly, LLM optional. Guilt copy is forbidden by test.
- **REQ-109** — keepsake gifts (`sim/keepsakes.ts`): affection ≥70 ∧ trust
  ≥55 ∧ ≥20h spacing → deterministic trinket (12-item table, seeded by
  pet+day), delight choreography + confetti, stored as a `keepsake` memory.
  New "Keepsake shelf" grid in Settings → Memory.
- **REQ-110** — hatch-day (`sim/hatchday.ts`): yearly month+day anniversary
  (memory-row dedupe) → confetti + celebration + memory; monthly
  day-of-month → small hearts once per session.

## Rhythm & touch

- **REQ-111** — time-of-day rituals (`sim/rituals.ts`): morning
  stretch+wiggle, evening wind-down, night settle (skipped if asleep);
  `TIME_OF_DAY_CHANGED` is now dispatched on transitions.
- **REQ-112** — drag dangle & landing (`sim/landing.ts`): `surprise` grab
  pose while the OS drag runs; drop detection piggybacks on the existing
  80ms hit-test poll (2 stable samples after a 400ms grace); landing squash,
  plus dizzy→shake recovery for drops ≥200 logical px.
- **REQ-113** — `animationIntensity` (0–1.5) scales particles and quirk
  chance, 0 disables both; Settings broadcasts `settings:changed` so the
  overlay updates live. Removed the dead blink interval (MochiSprite ignores
  the prop by design). No new persistent timers were added anywhere.

## Stage backgrounds (REQ-114, user-requested mid-release)

- Settings → General gains "Stage background": fully transparent (default
  overlay) or themed soft cards — cream, blossom, mint, night. Applied to
  `body[data-stage-background]` → `#app` with an 18px card radius; live via
  the `settings:changed` broadcast. Backend clamps to the closed list
  (`normalize_stage_background`, +2 model tests) and legacy settings blobs
  deserialize with a `transparent` default.

## Settings access, snack art, and sound (REQ-115..117, user-requested)

- **REQ-115** — the settings window finally has a way in: right-click →
  "Settings…" shows it (new `open_settings` command); closing hides instead
  of destroying (`on_window_event` CloseRequested → hide) so it always
  reopens; the view reloads on window focus so memories/keepsakes/reports
  stay fresh. Audit: no UI path to Settings existed at all since v0.1.
- **REQ-116** — snack-specific eat sprites: 4 new hand-drawn-style frames
  (`mochi-eat-strawberry-1/2.png`, `mochi-eat-cookie-1/2.png`) generated
  with GPT Image 2 from the original dango frames as style references,
  background-stripped through the same corner-detect + flood-fill pipeline
  (1254×1254, verified alpha). New `MovementState` literals + SRC entries +
  chew/reduced-motion CSS + glyph suppression via an `isEating` derived;
  `applySnackFeed` plays the picked snack's frames (dango keeps the
  originals).
- **REQ-117** — sound effects: `src/lib/audio/sfx.ts` synthesizes tiny
  oscillator chirps (no asset files) for user-initiated moments only — pat
  boop, tray pop, nom-nom, play bounce, rest settle, discovery/keepsake
  sparkle, greeting/hatch-day chime. Autonomous behaviors stay silent.
  Note tables are pure and tested (≤600 ms, gain ≤0.15, 150–1200 Hz).
  "Sound effects" toggle in Settings (default on), live via
  `settings:changed`; lazy AudioContext for autoplay policies; audio
  failures are swallowed.

## Live-feedback fixes (user desktop session)

- **macOS transparency was actually off** — the dev log showed
  "transparent but `macos-private-api` is not enabled": on macOS the
  overlay rendered on an opaque white canvas, which also made stage
  backgrounds look like no-ops. Enabled `app.macOSPrivateApi` (rules out
  Mac App Store distribution; not a target).
- **Settings discoverability, round 2** — replaced the top-right gear chip
  with a smaller ⚙ at the bottom-right of the opened status panel (per
  request); the right-click "Settings…" item stays.
- **Instant apply** — stage background, sound toggle, and animation
  intensity now save on change (select/checkbox/slider `onchange` → save →
  `settings:changed`), so the pet window updates immediately instead of
  waiting for a Save press.
- **Settings window scroll** — the global `overflow: hidden` (needed by the
  overlay) also clipped the settings page; `body.settings-page` is now a
  fixed-height scroll container.
- **Softer tray sound** — the Feed-click "pop" was a 35ms square wave that
  read as a harsh electronic tick; replaced with a two-note sine "plip" and
  added a test forbidding square/sawtooth anywhere in the palette.

## Post-review fixes (code-reviewer subagent pass)

- **CRITICAL** — the REQ-070 idle window required literal `idle` for 60s, but
  `chooseMovement` re-rolls among idle/sit/look_cursor every 3s tick
  (P(idle×20) ≈ 3×10⁻¹⁰): the autonomous report could never fire, and the
  quirk-yield rule would have permanently killed quirks after the pet's
  first 12h. Fixed by widening the gate's `IDLE_STATES` to the calm resting
  set {idle, sit, look_cursor, sleep}; Pet.svelte reuses the same constant;
  PRD §7.7/REQ-070 wording updated; gate tests extended.
- **HIGH** — `save_pet_state` blindly overwrote `last_report_at`, so the pet
  window's 4s debounced save rolled back reports triggered from the settings
  window. `last_report_at` is now monotonic in the backend (merge helper +
  2 new cargo tests).
- **MEDIUM** — `TIME_OF_DAY_CHANGED` early-returns in `maybeChoreography`
  (deterministic-ritual-only per REQ-111; also stops LLM-cooldown burn);
  the choreography bubble is suppressed for `FILE_INSPECTION_APPROVED` so a
  late LLM token can't replace the file summary; hatch-day dedupe now
  filters on memory type + marker, not marker alone.
- **LOW** — snack tray now takes focus on open and Feed exposes
  `aria-haspopup`/`aria-expanded`; `prefers-reduced-motion` is followed live
  via a change listener; `LANDING_STABLE_SAMPLES` 2→4 (fewer mid-drag false
  landings); the DPI cache refreshes after a drop (multi-monitor); keepsake
  choreography re-checks `actionPlayingUntil` after its awaited write.

## Verification

- `npm test` — **205/205** (was 128; +77 tests across 8 new sim modules and
  the gate/hatch-day review fixes)
- `npm run check` — 0 errors / 0 warnings
- `cd src-tauri && cargo test --lib` — **77/77** (+2 for the
  `last_report_at` monotonic guard)
- `cargo build` — passes (validates the capability addition)
- `npm run build` — passes
- Browser-preview smoke test (vite dev + agent-browser): boot greeting,
  snack tray (one clipping bug found & fixed), snack feeding, zero page
  errors / console errors. Desktop `tauri:dev` smoke NOT run this pass —
  drag-landing and click-through need a manual check there.

Rust changes: the capability file plus the `save_pet_state` monotonic
guard. All new behavior is deterministic-first and works with the LLM off.
