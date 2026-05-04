# AGENTS.md — Brief for AI Coding Agents

This file is a project-specific brief for AI coding agents (Claude Code,
OpenAI Codex, Cursor, Aider, Continue, Cline, etc.). Read this **before**
proposing changes. It encodes the conventions a human reviewer will hold
your PR to.

> If you are a human, [`CONTRIBUTING.md`](./CONTRIBUTING.md) is the file
> you want.

---

## TL;DR — non-negotiables

1. **The pet must feel alive even when the LLM is off.** Never make a core
   behavior depend on a network call.
2. **Simulation in `src/lib/sim/` stays pure.** No DOM, no Tauri imports,
   no `Math.random` without a seedable injection point.
3. **All four checks must pass before you propose a PR:**
   ```bash
   npm test                            # vitest
   npm run check                       # svelte-check (must be 0/0)
   cd src-tauri && cargo test --lib    # backend
   cd src-tauri && cargo build         # cargo check is fine for verifying
   ```
4. **Disclose AI assistance** in the PR description.

---

## Repo map

| Path | What lives there |
|---|---|
| `src/lib/sim/` | Pure simulation engine (mood, decay, movement, actions). All logic here is testable in isolation. |
| `src/lib/components/` | Svelte 5 components. `Pet.svelte` is the orchestrator. |
| `src/lib/bridge/` | Typed wrapper around Tauri's `invoke`. |
| `src/lib/events/` | In-process event bus + salience scoring. |
| `src-tauri/src/` | Rust backend. `commands.rs` has every `#[tauri::command]`. |
| `src-tauri/src/db.rs` | SQLite schema + CRUD. |
| `src-tauri/src/llm/` | LLM provider trait + Ollama implementation + prompts. |
| `src-tauri/src/sandbox.rs` | Pet home folder + safe file IO. |
| `public/sprites/` | PNG sprites referenced by `MochiSprite.svelte`'s SRC map. |
| `PRD.md` | Authoritative spec. Every requirement is `REQ-NNN`. |
| `BACKLOG.md` | Deferred work with rationale. |
| `DECISIONS.md` | Recent design decisions and the *why*. |

---

## Architecture invariants (don't break these)

### Simulation tick

`src/lib/sim/tick.ts:runTick(state, ctx, elapsedSeconds)` is pure. It
returns a new `PetState` based on:

1. `applyDecay` — accumulates fractional changes per second.
2. `deriveMood` — first matching predicate wins (energy<20 → tired, etc.).
3. `chooseMovement` — same first-match style.

Adding a behavior means adding to one of these, with a unit test.

### Stat values are integers at the boundaries

The backend models hunger/energy/affection/boredom/curiosity/stress/trust
/relationshipLevel as `i32`. The simulator keeps **fractional** values
internally so small decay rates accumulate smoothly across ticks.

If you call `api.savePetState(...)` directly, **wrap with `roundStats`**
from `sim/state.ts`:

```ts
import { roundStats } from "../sim";
await api.savePetState(roundStats(snapshot));
```

The display layer also rounds (see `PetStatus.svelte` — `Math.round(...)`
on every numeric badge). If you add a new stat readout in the UI, round it.

### Salience-gated LLM calls

LLM is *not* called every tick. The gate is in `src/lib/sim/salience.ts`
(`shouldCallLLM`) plus a 90s autonomous cooldown. Any new event type that
could trigger speech needs to pass through this gate.

### Sandbox path-jail

`src-tauri/src/sandbox.rs` enforces:
- reads only from `inbox/`
- writes only to `notes/`, `dreams/`, `exports/`
- no `..` segments, no absolute escapes, no symlinks resolving outside

If your change adds a new file IO path, route it through this module. Never
construct paths via string concatenation.

### Click-through hit testing

The overlay window uses `setIgnoreCursorEvents(true)` whenever the cursor
is *not* over an interactive element. `Pet.svelte:isInsideInteractive`
enumerates the interactive regions (pet, action panel, status pill, bubble,
inbox consent, context menu). If you add a new floating element that
should receive clicks, **add its bounding rect to that function** or it
will be invisible to the cursor.

---

## How to make a good change

### 1. Read three files before editing

- The file you're changing.
- Its tests (if any) — convention is `<name>.test.ts` next to the file.
- The PRD section that mentions the feature (search `PRD.md` for relevant
  REQ numbers).

### 2. Write the test first if there is one to write

For pure functions in `src/lib/sim/`, write the test before the
implementation. Example precedents:

- `src/lib/sim/actions.test.ts` — every action's stat deltas + animation
  sequence.
- `src/lib/sim/sim.test.ts` — `runTick`, `applyDecay`, `chooseMovement`.

### 3. Keep the diff surgical

Don't reformat adjacent code, don't "improve" comments, don't refactor
things that aren't broken. Every changed line should trace directly to
the task.

### 4. Verify before reporting done

- Run all four checks listed in TL;DR.
- For UI changes: actually launch `npm run tauri:dev` and **see** the
  change. State explicitly when you did or didn't smoke-test.
- For backend changes: confirm `cargo test --lib` includes the new test.

### 5. Write the PR description like a human

Include:
- **What changed** (1–2 sentences)
- **Why** (link to issue, or describe the problem)
- **How tested** (paste relevant `npm test` and manual notes)
- **Screenshots** for visual changes

---

## Common pitfalls

- **Adding `Math.random()` to a pure simulation function.** Use the
  `rng?: () => number` pattern that movement/actions/nudges all use, so
  tests can inject a deterministic stub.
- **Using `console.log` for instrumentation.** The codebase uses
  `console.warn` for non-fatal failures only. No info-level logs.
- **Persisting user secrets in cleartext.** API keys live in the dedicated
  `secrets` table via `set_cloud_api_key`. The frontend never sees them.
- **Breaking the salience gate.** Don't call the LLM from a tick handler.
- **Forgetting `aria-label` / focus management.** Every interactive
  element needs accessible naming. Inbox consent uses a focus trap; copy
  the pattern from `focusTrap.ts`.
- **Shipping a new sprite without an idle fallback.** If a new pose PNG
  is missing, `MochiSprite.svelte`'s `onerror` swaps to `mochi-idle.png`.
  Don't break that handler.

---

## What's out of scope for the MVP

Per [`PRD.md` §4.2](./PRD.md), the following are **deliberately not in
scope** and PRs adding them will be deferred:

- Voice input/output
- 3D / Live2D / VRM avatars
- Browser automation, shell execution
- Cloud account sync, mobile companion
- Marketplace plugins / remote skill installation

Open an issue first if you want to discuss any of these for v0.2+.

---

## Disclosing AI assistance

In your PR description, state:

> Generated/assisted with `<tool name + version>`. Verified the diff
> compiles, all four checks pass, and smoke-tested the UI manually.

We don't auto-reject AI-assisted PRs — we treat them like any other PR.
But honest disclosure helps the reviewer focus on the right things.
