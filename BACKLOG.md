# Pet Mochi UI/UX Backlog

Items identified during the 2026-05-03 UI/UX review (self + Codex `gpt-5.5`
second-opinion + code-reviewer agent) that were intentionally deferred.

For context on the closed items see commits `c4448b5` (CRITICAL+HIGH) and
PRs #1–#4 (MEDIUM).

---

## MEDIUM #15 — Differentiate autonomous-speech cooldowns by event kind

**Files**
- `src/lib/components/Pet.svelte` — constant `AUTONOMOUS_LOCAL_COOLDOWN_MS = 5 * 60_000`
- `src/lib/components/Pet.svelte` — `maybeAutonomousSpeak(kind, awayMinutes)`

**Issue**
A single 5-minute local cooldown is shared across all autonomous-speech
kinds. If a `USER_RETURNED` event fires once and the LLM call fails or the
user misses the bubble, no autonomous speech is attempted for 5 minutes.
Future kinds (e.g. `IDLE_LONG`, `MOOD_DROP`) would also collide.

**Possible fix**
Per-event cooldown map, e.g.
```ts
const COOLDOWN_BY_KIND: Record<string, number> = {
  returned: 10 * 60_000,
  mood_drop: 30 * 60_000,
  inbox_found: 2 * 60_000,
};
```

**Why deferred**
Product decision needed on per-kind timings and on whether retry-on-failure
is acceptable. Current single-cooldown behavior may be intentional throttling.

---

## LOW #16 — Redundant `aria-label` on Mochi SVG

**Files**
- `src/lib/components/Pet.svelte` — pet-anchor button has `aria-label="Mochi"`
- `src/lib/components/MochiSprite.svelte` — root `<svg>` has `aria-label="Mochi pet"`

**Issue**
Screen readers announce both names back-to-back.

**Fix**
The button already names the control. Hide the SVG from AT:
```svelte
<svg ... aria-hidden="true" focusable="false">
```

---

## LOW #17 — Settings loading state lacks semantics

**File**
- `src/lib/components/Settings.svelte` — `<p>Loading…</p>` near the top of the
  conditional render block when `settings` is null.

**Issue**
Plain text; not announced reliably during async load.

**Fix**
```svelte
<p role="status" aria-live="polite">Loading settings…</p>
```

---

## LOW #18 — ChatInput fixed width can crowd dock

**File**
- `src/lib/components/ChatInput.svelte` — `input { width: 180px; }`

**Issue**
Combined with the dock status pill, chat input can overflow narrow overlay
windows.

**Fix**
```css
.chat-input {
  display: flex;
  gap: 6px;
  max-width: min(280px, calc(100vw - 72px));
}
input {
  width: 100%;
  min-width: 0;
}
```

---

## LOW #19 — Mood color discrimination weak for muted tones

**File**
- `src/lib/components/MochiSprite.svelte` — `moodPalette`

**Issue**
`bored`, `lonely`, `tired` all use similar grayed-purple body tones. Hard to
distinguish at a glance.

**Fix**
Combine color with mood-specific accessory icons (already partial:
`zZ` for sleep, `?` for curious). Add for:
- `hungry` — small bowl/utensil glyph
- `bored` — yawn / "..." mark
- `lonely` — small heart glyph

---

## LOW #20 — Pet click forces immediate `jump` regardless of mood

**File**
- `src/lib/components/Pet.svelte` — `handlePetClick()` sets
  `currentAnimation: "jump"` unconditionally.

**Issue**
Clicking the pet while it's `sleep` snaps directly to `jump` with no wake-up
transition. Breaks animation/mood consistency.

**Fix**
Branch on current state:
```ts
const wake = pet.currentAnimation === "sleep";
pet = {
  ...pet,
  currentAnimation: wake ? "look_cursor" : "jump",
  ...
};
if (wake) {
  setTimeout(() => {
    pet = { ...pet, currentAnimation: "jump" };
  }, 320);
}
```

---

## MEDIUM #22 — Multi-monitor crossing disabled on mixed-DPI setups (REQ-121)

**Files**
- `src/lib/bridge/roamer.ts` — `getMonitors()` divides each monitor rect by
  its own `scaleFactor`
- `src/lib/sim/roam.ts` — `planMonitorCrossing` adjacency + y-clamp math

**Issue**
Adacency is computed in per-monitor *logical* space. When two monitors have
different scale factors, their logical rects overlap or gap incoherently
(e.g. 1920-phys @1× + 2560-phys @1.25 → logical `0–1920` and `1536–2584`),
so the "touching edges" test never passes and crossings silently no-op.
The y-clamp would also mix units between monitors. Uniform-DPI setups work
as specified; mixed-DPI degrades to REQ-120's single-monitor behavior.

**Why deferred**
Fixing it means rewriting the planner's geometry in one shared space
(physical px or primary-scale logical) and converting only at the bridge —
a behavior-bearing change to freshly landed code, punted after QA (M1)
rather than rushed at the end of the pack. The current failure mode is
safe: a silent no-op, never a wrong-position window.

**Suggested approach when picked up**
1. Keep `planMonitorCrossing` in physical pixels; move the logical↔physical
   conversion into `bridge/roamer.ts` (it already knows each monitor's
   `scaleFactor`).
2. Add a mixed-DPI fixture to `roam.test.ts` (1× + 1.25 monitors, expect
   adjacency + clamped y in physical space).
3. Re-verify the 30s cache refresh converts window position through the
   *current* monitor's scale after a crossing.

---

## ✅ Resolved — #21 Playwright e2e

- `npm run test:e2e` runs a Playwright suite (`tests/e2e/`, Chromium +
  WebKit, CI job "E2E (Playwright)") against the real Svelte app on a fake
  Tauri backend (`tests/e2e/harness.html` + `harness/backend.ts`, built on
  `@tauri-apps/api/mocks`). It covers boot, care actions, needs pacing (fake
  clock), hover cooldown, appearance, live resize, settings saving, keyboard
  menus and axe checks — the release-QA scenarios from v0.3.0.
- Not covered, by design: the `#[tauri::command]` boundary (the backend is a
  fake; `cargo test --lib` owns it) and the original §9.8 status-report /
  §9.11 choreography scenarios this entry proposed. Those still need
  `tauri-driver` + `webdriverio` if the integration glue ever warrants it.

---

## ✅ Resolved 2026-10-28 (v0.3.0) — #23, #24, #25

- **#23 Retention** — `event_log` rows older than 30 days are pruned at
  startup (diagnostic data only). `interactions`, memories, status reports
  and reflections are user data and are never auto-deleted.
- **#24 Settings that did nothing** — `startOnLogin` now registers/unregisters
  an OS login item (`tauri-plugin-autostart`, Rust-side only); `petHomePath`
  is shown read-only with the real path (move it with `MOCHI_HOME` at
  launch). Correction: `developerEventLog` was never dead — it gates the
  Settings → Developer tab.
- **#25 Needs pacing** — "medium" pacing: hungry ~30 min after a feed,
  tired ~60 min after waking, bored ~15 min after play (was 6 / 8 / 5 min).

---

## References

- Codex review output (gitignored): `codex-uiux-out.txt`
- Self-review + `code-reviewer` agent results: see commit messages and PR
  descriptions for #1–#4
- Live dev verification still required: run `npm run tauri:dev` and walk
  through the manual checklists in each PR's "Test plan".
