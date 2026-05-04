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

## MEDIUM #21 — Playwright e2e for §9.8 status report and §9.11 choreography

**Files (would create)**
- `tests/e2e/status-report.spec.ts` — boot app with mocked clock 12h+1m past
  `lastReportAt`, send IDLE_TICK for 60s, assert a file appears under
  `pet_home/dreams/` and the "Recent status reports" list populates.
- `tests/e2e/choreography.spec.ts` — fire `USER_RETURNED` after 35-min absence,
  assert sprite cycles through ≥2 distinct `MovementState` frames within 3s
  and the bubble shows a closed-vocabulary token.
- `playwright.config.ts` (new), `package.json` (`@playwright/test` devDep).

**Why deferred**
Tauri webview e2e cannot be driven by stock Playwright — it needs
`tauri-driver` + `webdriverio`, and the dev-server preview path doesn't
exercise the `#[tauri::command]` boundary that holds most of the new logic
(REQ-070..076 + REQ-094..099). The simulation engine is already 100%
covered by vitest (128 tests), and `cargo test --lib` covers the Rust
side (75 tests). End-to-end value here is mostly the integration glue,
which is small.

**Suggested approach when picked up**
1. Add `tauri-driver` (Rust binary) + `webdriverio` (Node) instead of
   raw Playwright.
2. Or, alternatively, add `@testing-library/svelte` integration tests
   that mock `api.invoke` — covers ~80% of the gap at ~10% of the cost.
3. The pure logic is already gated by `statusReportGate.test.ts` and
   `choreography.test.ts`, so the e2e job is to verify wiring, not
   correctness.

---

## References

- Codex review output (gitignored): `codex-uiux-out.txt`
- Self-review + `code-reviewer` agent results: see commit messages and PR
  descriptions for #1–#4
- Live dev verification still required: run `npm run tauri:dev` and walk
  through the manual checklists in each PR's "Test plan".
