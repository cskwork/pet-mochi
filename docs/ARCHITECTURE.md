# Architecture

A deeper dive than the README. Explains how Pet Mochi stays alive without
an LLM, where the boundaries are, and why the layering is the way it is.

> Authoritative spec: [`PRD.md`](../PRD.md). Where this doc and the PRD
> disagree, the PRD wins.

---

## 1. The four layers

```
┌──────────────────────────────────────────────────────────────────┐
│  UI                  Svelte 5 components, CSS animation,         │
│                      sprite cycling, bubble placement            │
├──────────────────────────────────────────────────────────────────┤
│  Simulation engine   Pure TS in src/lib/sim/                     │
│                      runTick → applyDecay → deriveMood →         │
│                      chooseMovement                              │
├──────────────────────────────────────────────────────────────────┤
│  Bridge / events     Typed Tauri invoke wrapper +                │
│                      in-process event bus + salience gate        │
├──────────────────────────────────────────────────────────────────┤
│  Backend             Rust: SQLite, FTS5 search, sandbox file IO, │
│                      LLM provider trait, inbox watcher           │
└──────────────────────────────────────────────────────────────────┘
```

The simulation engine is the **most important layer** in the project.
Everything else is in service of it. It is testable in isolation (no DOM,
no Tauri, no async) and that property is non-negotiable.

---

## 2. The 3-second simulation tick

`Pet.svelte` runs `tick()` on a 3 s `setInterval`. Each tick:

1. Computes `RuntimeContext` (cursor proximity, away time, time-of-day).
2. Calls the pure `runTick(state, ctx, elapsedSec)`:
   - **`applyDecay`** — `hunger += 0.10/s`, `energy -= 0.08/s` (or `+0.5/s`
     while sleeping), `boredom += 0.10/s`, `curiosity` drifts toward 60,
     `stress` recovers slowly, `affection` slowly drains after 30 min of
     no interaction. Values are stored as **floats** for accurate
     accumulation.
   - **`deriveMood`** — first matching predicate wins
     (`energy<20 → tired`, `hunger>75 → hungry`, …).
   - **`chooseMovement`** — same first-match style, with idle variants
     picked from a deterministic seedable RNG.
3. If walking/running, calls `nextWanderPosition` to pick a target.
4. Maybe fires a canned **nudge bubble** (mood-cued speech, no LLM —
   gated by per-kind + global cooldowns in `nudges.ts`).
5. Edge-triggers a `USER_RETURNED` event when away→returning.
6. Schedules a debounced backend save.

Why pure functions? Because the core feel of the pet is regression-tested
without spinning up Tauri or a webview. `npm test` runs ~99 sim tests in
under a second.

---

## 3. Why values are floats internally but integers at the boundaries

The decay rates per second are deliberately small (`0.05`, `0.10`). If
each tick rounded to int, decay below `0.5`/tick would round to zero and
nothing would ever change.

So the simulator keeps **floats internally** for smooth accumulation, and
converts to `i32` at exactly two boundaries:

- **Persistence** — `Pet.svelte:scheduleSave` wraps the snapshot with
  `roundStats(...)` from `sim/state.ts`. The backend's `PetState` models
  every stat as `i32`; serde rejects fractional inputs.
- **Display** — `PetStatus.svelte` calls `Math.round(...)` on every
  numeric badge. Otherwise users see `♥0.999754` instead of `♥1`.

If you add a new place that displays or persists a stat, do the rounding
there. Don't push it back into the simulator.

---

## 4. Salience-gated LLM calls

The LLM is *not* in the tick path. Calls happen only when an event
clears the salience gate in `src/lib/sim/salience.ts`:

```ts
function shouldCallLLM(event, state): boolean {
  const salience = eventImportance(event)
                 + moodUrgency(state)
                 + relationshipWeight(state);
  return salience >= 70 && cooldownPassed("llm_autonomous", 90_000);
}
```

High-salience events that pass: first launch, first interaction of the
day, USER_RETURNED after long absence, USER_SENT_MESSAGE, file inspection
approved, daily reflection due.

Low-salience events that don't: idle tick, hover, repeated clicks.

Plus a **second cooldown layer** in `Pet.svelte:maybeAutonomousSpeak`
(currently 5 minutes per kind) so even a repeated qualifying event won't
spam the LLM. And a third cooldown in the Rust LLM adapter as a backstop.

The result: a typical user sees zero LLM calls during normal idle use.

---

## 5. Memory engine

Stored in SQLite with FTS5 for prefix search. The schema lives in
`src-tauri/src/db.rs:SCHEMA_SQL`. Three tables matter:

- **`memories`** — durable, importance-weighted facts the pet has learned.
- **`interactions`** — the running log of events. Used for daily
  reflection and report generation.
- **`memories_fts`** — virtual FTS5 table populated by triggers on
  `memories`. Supports the `MATCH` queries used in retrieval.

Retrieval ranks candidates by:

```
0.4 × importance + 0.3 × recency + 0.3 × confidence
```

So a memory the pet was 90 % sure about three weeks ago beats one it was
30 % sure about an hour ago. See `commands.rs:search_memories`.

Memory **extraction** runs *only* after LLM-backed replies (best-effort,
JSON-mode prompt). If the model returns garbage, the extraction is
silently dropped — never crashes the chat path.

---

## 6. Sandbox model

The pet has a home folder (default `%LOCALAPPDATA%\pet-mochi\` on
Windows, `~/Library/Application Support/pet-mochi/` on macOS,
`~/.local/share/pet-mochi/` on Linux):

```
pet-mochi/
├─ inbox/      ← user drops files here, Mochi asks before reading
├─ notes/      ← Mochi writes file summaries
├─ dreams/     ← daily reflections
├─ exports/    ← memory exports
└─ mochi.db    ← SQLite memory + state
```

`src-tauri/src/sandbox.rs` enforces:

1. Reads only from `inbox/`.
2. Writes only to `notes/`, `dreams/`, `exports/`.
3. No `..` segments, no absolute path escapes, no symlinks resolving
   outside the home folder.
4. Path canonicalization happens before *any* `fs::read` or `fs::write`.

There is no shell execution, no remote skill loading, no arbitrary
network requests outside the configured LLM endpoint.

The inbox watcher (`src-tauri/src/watcher.rs`) emits `inbox:file-found`
events to the webview; the user must explicitly approve each file via
the consent dialog before Mochi reads it (REQ-084).

---

## 7. Event flow on a typical interaction

User clicks the **Pat** button:

```
PetActions.svelte
  └─ onAction("pet")
     └─ Pet.svelte:onAction
        ├─ applyAction(pet, "pet")          // pure, returns state + steps
        ├─ playSteps(steps)                  // schedules animation frames
        ├─ flashBubble(bubble, 2.5s)
        ├─ api.logEvent("USER_CLICKED_PET", undefined, 20)
        │   └─ commands::log_event           // SQLite insert
        └─ scheduleSave()
           └─ (4s debounce)
              └─ api.savePetState(roundStats(pet))
                 └─ commands::save_pet_state // SQLite upsert
```

Note what is **not** in this path: any LLM call, any network IO. A pat
is local, deterministic, and free.

User sends a chat message via Settings → chat panel:

```
api.sendMessage(text)
  └─ commands::send_message
     ├─ retrieve top-N relevant memories (FTS5)
     ├─ build pet_reply_prompt with mood + memory snippets
     ├─ provider.generate(prompt)           // Ollama or other
     │  ├─ on success: store interaction, fire memory extraction job
     │  └─ on failure: deterministic fallback string
     └─ return ChatReply { text, usedLlm, pet }
```

The cooldown (`LLM_REPLY_COOLDOWN: 2s`) prevents button-mash spam. Memory
extraction is fire-and-forget — it doesn't block the reply.

---

## 8. Why Tauri (not Electron)

- ~10× lower memory baseline than Electron for the overlay.
- The Rust backend gets us SQLite, file IO, and LLM HTTP without
  shipping Node modules.
- Tauri 2's transparent + always-on-top + click-through-region support is
  exactly what the desktop pet UX needs.

The trade-off: WebView2/wkwebview bugs are platform-specific and harder
to debug than Chromium. We accept that for the size and privacy wins.

---

## 9. Testing strategy

- **Pure simulation logic** (`src/lib/sim/`) → vitest. Aim for
  coverage of every branch in mood/movement/decay/actions/nudges. Inject
  RNG so tests are deterministic.
- **Backend logic** (`src-tauri/src/*.rs`) → `cargo test --lib`. Uses
  `Db::open_in_memory()` so tests don't touch the user's filesystem.
- **Bridge / Svelte components** → mostly tested via the simulation tests
  on the data they consume; UI is verified manually with
  `npm run tauri:dev`.

If you change something visual, **launch the desktop app and look at it.**
Type checks and unit tests verify code correctness, not feature correctness.

---

## 10. References

- [`PRD.md`](../PRD.md) — full requirements with REQ numbers.
- [`BACKLOG.md`](../BACKLOG.md) — deferred items + rationale.
- [`DECISIONS.md`](../DECISIONS.md) — recent design decisions.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — humans contributing.
- [`AGENTS.md`](../AGENTS.md) — AI agents contributing.
