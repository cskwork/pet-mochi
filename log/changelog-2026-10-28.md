# Changelog — 2026-10-28 · "Lively Update" (bugs, performance, personality)

An audit (frontend, backend, and desktop-pet research) found that Mochi felt
less alive mainly because of core-loop bugs, not missing features. This
release fixes those first, then cuts runtime cost, then makes the existing
personality setting real and adds art-free customization.

## Behavior loop — fixed

- **Fake "user returned".** It used to fire after 30 min without *clicking
  Mochi*: she greeted an empty room and then ran on ~95% of ticks until
  clicked. Presence now means 30 min without any global cursor movement or
  pet interaction (`sim/presence.ts`); the return fires once with the real
  away time, and `run` lasts 10 s. Positions are compared in memory only,
  never stored.
- **Naps lasted one tick.** Sleep now has hysteresis (asleep until energy
  ≥ 60) and boredom is frozen while asleep, so night sleep and Rest hold.
- **Trust, bond and stress never rose**, so keepsakes (trust ≥ 55) were
  unreachable and the bond heart could only fall. Trust +1 per care action,
  bond +0.5 per spaced visit (≥ 10 min apart), stress +6 on a dizzy landing.
- **Stale overwrites.** Autonomous speech, chat and status reports saved a
  pre-LLM pet snapshot after the await, reverting a feed or pat made
  meanwhile. Each now updates only its own columns; the frontend merges only
  `lastLlmCallAt` (the TS type had the wrong field name).
- Per-tick decay capped at 60 s (OS sleep no longer slams stats); no
  wandering during actions or drags; delayed reactions no longer cut off a
  user action; rituals deferred instead of dropped; `look_cursor` stops when
  the pointer leaves; Settings focus no longer discards unsaved edits; inbox
  files present at launch are offered; walking glides instead of teleporting.

## Security & privacy — fixed

- `local_only_mode` bypass: `http://example.com?@localhost` was classified as
  loopback. Endpoints are now parsed with `reqwest::Url`; the Ollama client
  no longer follows redirects.
- Sandbox: writes refuse symlinked subdirectories and open with
  `O_NOFOLLOW`; a symlinked `inbox/` can no longer expose outside files.
- Status reports and daily reflections respect `memoryEnabled`.
- `rust-version` corrected 1.77 → 1.89 (`notify-rust` 4.18 requires it).

## Performance

- Sprites downscaled 1254 px → 448 px: 34 MB → 3.5 MB on disk, ~6.3 MB →
  ~0.8 MB decoded per pose; all poses preloaded and decoded at mount.
- Click-through polling: was `cursorPosition` + `outerPosition` every 80 ms
  (~25 IPC/s). Now one call per poll, self-scheduled with an in-flight guard,
  80 ms near the overlay and 400 ms when far; window position cached.
- Continuous animations stop at intensity 0; the AudioContext suspends after
  30 s idle; `export_memories` runs off the IPC thread and exports every row.

## Personality & customization

- `personalityPreset` (curious / lazy / playful / quiet) was saved but never
  read. It now tunes quirks, idle poses, wandering, sleep thresholds, nudges,
  and the LLM persona. `curious` reproduces the previous behavior exactly.
- Settings → Appearance: size 0.75–1.5×, six skins, five head accessories
  (anchored per pose, hidden in sleep/roll/hide/peek). Rename and
  always-on-top now apply live.
- Hover reaction (20 s cooldown, no LLM, no sound) and more hungry/lonely
  quirk variety.

## Verification

`npm test` 304 passed (was 255) · `npm run check` 0/0 ·
`cargo +1.95.0 test --lib` 102 passed (was 79) · `cargo build` OK ·
smoke-tested in `tauri dev` with an isolated `MOCHI_HOME`.

Still open: see BACKLOG #23–#25.
