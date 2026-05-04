# Pet Mochi — Feature Improvements Decisions

**Date:** 2026-05-04
**Scope:** Address pending BACKLOG.md items with best-practice fixes.

---

## Method

Reviewed `BACKLOG.md` (six items deferred from the 2026-05-03 UI/UX review)
plus the current state of the codebase. Each item was re-evaluated against
the current code: some were still applicable, some had become obsolete, one
was speculative.

Implementation was kept surgical (one concern per change, no adjacent
"improvements"). Reviews delegated to `typescript-reviewer` and
`code-reviewer` subagents in parallel after the initial diff.

---

## Implemented

### 1. Mood-distinguishing glyphs — BACKLOG #19 (LOW)

**Files:** `src/lib/components/MochiSprite.svelte`

`hungry`, `bored`, `lonely`, and `tired` all use desaturated/dim mood
filters that read nearly identical at a glance. Only `curious` had a
distinguishing glyph (`?`). Added three more glyphs:

- `hungry` → 🍡 (matches the feed-action icon for visual continuity)
- `bored` → `…` (passive ellipsis suggests waiting/disinterest)
- `lonely` → ♡ (outline heart, distinct from celebrate's filled `♥`)

Each is suppressed when:
- the pet is asleep (pose-internal), or
- a conflicting action is mid-sequence (e.g. `eat` during hungry-mood,
  `blush` during lonely-mood), so glyphs never visually fight each other.

The existing `.mark` reduced-motion CSS rule already covers the new classes.

### 2. Sleep wake-up transition for pat — BACKLOG #20 (LOW)

**Files:** `src/lib/sim/actions.ts`, `src/lib/sim/actions.test.ts`

`applyAction("pet")` previously played `blush → celebrate` regardless of
the pet's current pose. Patting a sleeping pet snapped from `sleep` to
`celebrate` with no wake-up beat, breaking the animation continuity.

Fix: `petSteps(prior)` now branches on the prior animation. If it was
`sleep`, the sequence becomes `yawn → blush → celebrate` (~1.4s total).
Otherwise it remains `blush → celebrate` (~1s).

One unit test added to actions.test.ts; existing tests still pass since
the default-pet test starts in `idle`, not `sleep`.

### 3. Redundant aria-label removal — BACKLOG #16 (LOW)

**Files:** `src/lib/components/MochiSprite.svelte`

The pet button already has `aria-label="Mochi"`. The inner `<img>` had
`alt="Mochi pet"`, so screen readers announced "Mochi… Mochi pet" back
to back.

Fix: `alt=""` on the image. This is the canonical pattern for decorative
images inside a labeled control — the button names the control, the
image has no semantic value to announce separately.

(Note: the BACKLOG entry mentioned an SVG sprite, but the codebase has
since switched to PNG sprites with an `<img>` tag. Same problem, slightly
different fix.)

### 4. Settings loading announcement — BACKLOG #17 (LOW)

**Files:** `src/lib/components/Settings.svelte`

`<p>Loading…</p>` was not announced to screen readers. The settings tab
panel can take a moment to fetch state, memories, inbox, events, and
last reflection in parallel — without a live region the user gets no
audible feedback that the page is working.

Fix: `<p role="status" aria-live="polite">Loading settings…</p>`.

---

## Skipped (with rationale)

### BACKLOG #15 (MEDIUM) — per-event-kind cooldowns for autonomous speech

The current code dispatches exactly one autonomous-speech kind:
`"returned"` (from `Pet.svelte:730-733`). The single 5-minute cooldown
is sufficient for that. Generalizing `tryEnterAutonomous` to a
per-kind cooldown map would be speculative flexibility for a hypothetical
second kind that doesn't exist yet.

**Recommendation:** introduce per-kind cooldowns in the same PR that
adds the second kind (e.g. `mood_drop`, `idle_long`). Leaving the gate
simple keeps it easier to reason about in the meantime.

### BACKLOG #18 (LOW) — ChatInput fixed width

The `ChatInput.svelte` component referenced in this BACKLOG entry no
longer exists in `src/lib/components/`. The chat-via-LLM flow currently
goes through the bubble + autonomous speech path; there is no inline
text input to crowd the dock. **Obsolete — backlog entry can be deleted.**

---

## Verification

- `npm test` — **96/96 passing** (was 95; one new test added for #20)
- `npm run check` — **0 errors, 0 warnings**
- Subagent reviews (parallel, post-implementation):
  - `code-reviewer`: 1 HIGH + 2 MEDIUM. HIGH (`bored` glyph collides with
    `blush`/`celebrate` action animations) **fixed**. MEDIUM #1 (`yawn`
    timing during wake-up) verified — `playSteps` sets the first frame
    synchronously so no flash occurs. MEDIUM #2 (`alt=""` only valid
    inside a labeled container) accepted; component is currently used
    only inside the `aria-label="Mochi"` button.
  - `typescript-reviewer`: 0 CRITICAL/HIGH; 2 MEDIUM both fixed
    (`bored` glyph also suppressed during `yawn`; redundant
    `expect(animations[0]).toBe(...)` removed in favor of single
    `toEqual`).

---

## Out of scope / not changed

- LLM provider changes — none of these items touch the LLM path.
- Memory engine — untouched.
- Sandbox / inbox — untouched.
- Pet state schema — untouched (PRD §13 contract preserved).
- Animation tuning of existing poses — untouched (only added glyphs).

The change is purely UX/a11y refinement. Behavioral parity for the
no-LLM "feel alive" path (PRD §6.2) is preserved.
