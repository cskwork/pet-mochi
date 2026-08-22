# Spec — Environment Pack (v0.2.x) + Modularity Pass

> Status: proposed. On approval, folds into `PRD.md` as §28 (REQ-118..REQ-124).
> Branch: `feat/environment-pack`. Author: orchestrator (six-pack methodology,
> specifier phase). All file/line references verified against `bfab039`.

## 0. Goals

1. Make Mochi's world respond to the *real* environment: time of day, screen
   edges, multiple monitors, critical needs.
2. Improve modularity so these features (and the next ones) land in small,
   pure, testable modules instead of growing `Pet.svelte`.

Non-goals: cursor chasing, typing reactions, window-edge *perching* (static
sit-on-edge pose) stays out — §27.8 — but *walking along/across edges* is in
scope because it reuses the wander path with no new APIs beyond monitors.

## 1. Current state (evidence)

| Capability | Status | Evidence |
|---|---|---|
| Time-of-day detection | shipped | `sim/tick.ts:deriveTimeOfDay`, `RuntimeContext.timeOfDay` |
| Period-transition ritual | shipped | REQ-111, `sim/rituals.ts`, `Pet.svelte:331-340` |
| Stage backgrounds | shipped (closed list) | REQ-114, `models.rs:STAGE_BACKGROUNDS`, `applyStageBackground` |
| Wander within window | shipped | `sim/movement.ts:nextWanderPosition` (360×360 viewport) |
| Window positioning | capability granted | `capabilities/default.json: allow-set-position` |
| Monitor enumeration | **missing** | no `availableMonitors` usage; capability absent |
| OS notifications | **missing** | none; PRD §27.2 forbids by default |
| Sleep propensity by time | **missing** | `chooseMovement` gates sleep on `energy < 15` only |

Modularity debt: `Pet.svelte` = 1839 lines / ~65 KB holding tick loop, save
scheduling, drag + hit-test, snack tray, keepsakes, hatch-day, particles,
choreography, autonomous speech, inbox queue, context menu, settings wiring.
`commands.rs` = 39 KB / 24 commands across 6 domains. `db.rs` = 50 KB.

## 2. Features

### REQ-118 — Auto stage theme (day/night visual cycle)

`stage_background` gains the value `"auto"` (closed list grows to 6; serde
default stays `"transparent"` so old blobs deserialize). When auto, the
frontend resolves the period → theme mapping (`morning→blossom`,
`afternoon→mint`, `evening→cream`, `night→night`) and applies it through the
existing `applyStageBackground` path. Resolution is a pure function
(`sim/ambient.ts:resolveStageTheme(period)`), unit-tested. Live theme swap on
`TIME_OF_DAY_CHANGED` (no new listener — the transition branch in `tick()`
already runs). On `"transparent"`, auto does nothing (no tint over the raw
desktop). Reduced-motion unaffected (backgrounds are static).

### REQ-119 — Night sleep propensity

`chooseMovement(state, ctx)` gains one pure branch: during `ctx.timeOfDay ===
"night"`, sleep is chosen when `energy < 30` (vs 15) and `boredom < 60`, so a
tired-at-night pet sleeps instead of pacing. Seeded tests extend
`sim.test.ts`. No decay-rate changes — only movement selection.

### REQ-120 — Screen-edge walking (window follows pet)

Today the pet stops at the 360×360 window border (`nextWanderPosition`
clamps). New pure module `sim/roam.ts`:

```
advanceRoam(winPos, petPos, step, workArea, viewport) ->
  { winPos', petPos' } | null
```

When the pet's next wander step would clamp at a viewport edge AND the window
can still move within the monitor work area, the window shifts by the same
delta (same frame, via existing `set_position` capability) and the pet keeps
its un-clamped position — the pet appears to walk across the desktop. When the
work-area edge is reached, behavior is exactly today's clamp. Pure, seeded,
tested (edge cases: work-area corners, scale factor, `null` on no-op).
Integration: called from `tick()`'s walk branch only — **no new timers**
(REQ-113). Window moves never focus (no focus stealing, §27.2.2).

### REQ-121 — Multi-monitor roaming

Add capabilities `core:window:allow-available-monitors` and
`core:window:allow-current-monitor`. New `sim/roam.ts` pure planner:

```
planMonitorCrossing(winPos, monitors, currentMonitorId, rng) ->
  { targetMonitorId, entryEdge: "left"|"right" } | null
```

Occasional (seeded, ≤ ~1 crossing per 10 idle minutes, mood-gated: curious or
bored only) the pet walks off the current monitor's edge and the window
re-enters at the adjacent monitor's opposite edge (same y, clamped).
Scale-factor differences handled by converting through the existing
`cachedScaleFactor` + per-monitor `scaleFactor` refresh on crossing.
Monitor hot-plug: on a failed crossing, re-enumerate once and abort silently
(never a bubble, never a crash). Pure logic tested; the Tauri-callable part
stays in a thin `bridge/roamer.ts` wrapper.

### REQ-122 — Opt-in critical-need notifications (amends §27.2)

§27.2 principle 1 ("no notifications") is amended: **with explicit user
opt-in** (default **off**), Mochi sends an OS notification when a need crosses
critical: `hunger > 85`, `energy < 12`, or `stress > 80`. Rules:

- New setting `desktop_notifications: bool` (`#[serde(default)]` → false;
  Settings UI toggle under a "Environment" group).
- Pure gate `sim/notifications.ts:shouldNotify(state, lastByKind, now)` —
  per-kind cooldown 60 min, global 30 min, suppressed while the settings
  window is focused (the user is already looking at Mochi), suppressed for
  the first 10 minutes after launch (no notification on boot). Unit-tested.
- Copy is kind, never guilty — enforced by a forbidden-phrases test like
  REQ-108's ("finally", "you left me", "why did you", …).
- Uses `tauri-plugin-notification` (Cargo + JS binding + capability
  `notification:default`). Silent per §27.2.2 — no sound, no badge, no sfx.
- The PRD amendment lands in the same commit as the feature, with this spec
  linked.

### REQ-123 — Capabilities & settings additions

One commit adds: monitor capabilities (REQ-121), notification plugin +
permission (REQ-122), `desktop_notifications` field with serde default, and
`"auto"` in `STAGE_BACKGROUNDS` + `normalize_stage_background`. No other
capability widening; JS still gets no fs/shell.

### REQ-124 — Modularity pass (extraction in service of §28)

Staged, each step behind green checks; no behavior change without its REQ:

1. `sim/roam.ts`, `sim/ambient.ts`, `sim/notifications.ts` — new pure modules
   (this pack). Tests colocated.
2. Extract from `Pet.svelte` into Svelte 5 composable modules
   (`.svelte.ts`), each owning its `$state` slice:
   - `components/snackTray.svelte.ts` (REQ-107 tray state machine)
   - `components/gifts.svelte.ts` (keepsakes + hatch-day)
   - `components/particles.svelte.ts` (REQ-105 live-particle store)
   - `components/roam.svelte.ts` (window/pet position co-management for
     REQ-120/121, wrapping `bridge/roamer.ts`)
   - `components/notify.svelte.ts` (REQ-122 gate + plugin call)
   `Pet.svelte` keeps: tick loop, context building, event wiring — target
   ≤ ~1000 lines.
3. Split `commands.rs` by domain into `commands/` (mod.rs re-exports;
   `state.rs`, `memory.rs`, `chat.rs`, `inbox.rs`, `reports.rs`) — pure move,
   `generate_handler!` list unchanged semantics, `cargo test --lib` green.

## 3. Guardrails carried forward

- Four checks green after every stage: `npm test`, `npm run check` (0/0),
  `cargo test --lib`, `cargo build`.
- No new persistent timers (REQ-113) — everything rides the 3 s tick /
  80 ms poll / one-shot animation timers.
- Pure sim: no DOM/Tauri imports in `sim/`; RNG injectable everywhere.
- Integers at boundaries (`roundStats`); no new persisted stats.
- Salience gate untouched — notifications are deterministic, not LLM.
- Transform/opacity-only visuals; reduced-motion safe; a11y labels for any
  new control (settings toggles).

## 4. Implementation order

REQ-123 (foundation) → 118 → 119 → 120 → 124.2-roam → 121 → 122 → 124.3
(commands split, last, lowest risk appetite). Each step = tests first, then
impl, then the four checks, one commit per REQ.
