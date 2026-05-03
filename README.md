# 🍡 Pet Mochi

A local-first AI digital pet that lives on your desktop. Mochi moves on its own,
remembers what matters, and chats briefly through an optional local LLM.

Built end-to-end against [`PRD.md`](./PRD.md) with Tauri + Svelte 5 + Rust + SQLite.

> **The pet must feel alive even when the LLM is off.**

## Architecture

| Layer | Tech | Notes |
|---|---|---|
| Desktop shell | **Tauri 2** | Transparent, always-on-top, draggable overlay window. |
| UI | **Svelte 5 + TypeScript** | Pure-SVG mochi sprite, no extra renderer. |
| Simulation engine | TypeScript pure functions | mood/decay/movement; testable, no LLM required. |
| Memory engine | **Rust + rusqlite + FTS5** | Durable memories, prefix search, recency × importance ranking. |
| LLM adapter | Rust + reqwest | Pluggable `LlmProvider` trait. **Ollama** is the first impl. |
| Sandbox | Rust | Inbox watcher (`notify`), path-jail safe IO, declarative skills. |

```
src/                       Svelte + TypeScript frontend
├─ App.svelte              Routes pet (default) and settings (#/settings)
├─ lib/
│  ├─ sim/                 Pure simulation engine (testable)
│  ├─ events/bus.ts        In-process event bus + salience-driven LLM gating
│  ├─ bridge/              Tauri invoke wrapper + typed API
│  └─ components/          Pet, MochiSprite, ChatBubble, ChatInput, Settings
src-tauri/                 Rust backend
├─ src/
│  ├─ db.rs                SQLite schema, FTS5 search, CRUD
│  ├─ llm/                 Provider trait, Ollama, prompts, cooldowns
│  ├─ sandbox.rs           Pet home, safe file IO, skill manifests
│  ├─ watcher.rs           notify-based inbox watcher
│  ├─ commands.rs          Every #[tauri::command]
│  ├─ state.rs             Shared AppState (Arc<Db>, LLM, cooldowns)
│  └─ lib.rs               Tauri builder, plugin wiring, setup
```

## Requirements

- **Node** ≥ 20 (verified on 22.14)
- **Rust** ≥ 1.77 (verified on 1.88)
- A platform supported by Tauri 2 (Windows / macOS / Linux)
- *Optional:* [Ollama](https://ollama.com/) running locally for chat

## Quick start

```bash
npm install
npm run tauri:dev      # launches the desktop pet in dev mode
```

Settings open via `index.html#/settings` (the Tauri config registers a second
window for them). The pet always works without a backend reachable, but chat,
memory, and inbox features require running through Tauri.

### Run tests

```bash
npm test                                 # 20 frontend simulation tests (vitest)
cd src-tauri && cargo test --lib         # 19 backend tests (db, sandbox, llm cooldown, prompts)
```

### Type-check & build

```bash
npm run check          # svelte-check
npm run build          # vite frontend bundle
npm run tauri:build    # full desktop installer (icons already generated)
```

## Talking to Mochi (optional)

Pet Mochi is happy in silent mode. To enable chat, install Ollama and pull a
model:

```bash
ollama pull llama3.2
```

Open Settings → set provider to `ollama`, point endpoint at `http://localhost:11434`
and choose a model. Mochi will retrieve relevant memories, send a compressed
prompt, and store an interaction. A best-effort memory extraction job runs in
the background after each LLM-backed reply.

## Sandbox

The pet's home folder lives at:

| OS | Path |
|---|---|
| Windows | `%LOCALAPPDATA%\pet-mochi\` |
| macOS | `~/Library/Application Support/pet-mochi/` |
| Linux | `~/.local/share/pet-mochi/` |

Override with the `MOCHI_HOME` env var.

```
pet-mochi/
├─ inbox/      ← drop .txt / .md / .json files here
├─ notes/      ← Mochi writes summaries
├─ dreams/     ← daily reflections
├─ exports/    ← memory exports (Markdown / JSON)
└─ mochi.db    ← SQLite memory + state
```

Mochi never reads files outside `inbox/`, never writes outside `notes/`, `dreams/`
or `exports/`, never executes shell commands, and refuses paths containing `..`,
absolute escapes, or symlinks that resolve outside the sandbox.

## PRD coverage

Every numbered requirement (REQ-001 … REQ-093) from `PRD.md` is implemented or
explicitly out-of-scope for the MVP. Highlights:

- ✅ Transparent always-on-top draggable overlay (REQ-001…005)
- ✅ Idle / walk / sleep / jump / sit / look_cursor / celebrate / hide / run animations (REQ-010)
- ✅ Deterministic simulation, LLM-free movement (REQ-011…013)
- ✅ Hidden stats with decay & recovery (REQ-020…024)
- ✅ Event bus with salience scoring & LLM cooldown (REQ-030…033, §14.1)
- ✅ Provider trait (`LlmProvider`) — Ollama default, swappable (REQ-040…044)
- ✅ Short, mood-aware chat replies with graceful fallback (REQ-050…054)
- ✅ SQLite + FTS5 memory store, recency × importance × confidence ranking (REQ-060…066)
- ✅ Daily reflection (LLM optional; deterministic fallback) → `dreams/` (REQ-070…073)
- ✅ Pet home folder with `inbox/`, `notes/`, `dreams/`, `exports/` (REQ-080…084)
- ✅ Declarative skill manifests, no remote skill installation (REQ-090…093)

Out of scope for MVP (per PRD §4.2): voice, 3D/Live2D, browser automation,
shell execution, cloud sync, marketplace plugins.

## Design choices worth knowing

- **Simulation first.** A `runTick(state, ctx, elapsed)` pure function decides
  the pet's behavior every 3s. The LLM is consulted only when an event's salience
  clears 70 *and* a 90-second autonomous cooldown has passed.
- **Memory ranking.** FTS5 prefix search retrieves candidates; we re-rank by
  `0.4 × importance + 0.3 × recency + 0.3 × confidence` so old-but-important
  memories beat fresh trivia.
- **Failure first.** The pet keeps animating when the DB is unavailable, when
  Ollama is offline, when memory extraction returns garbage JSON. Failures log
  warnings instead of bubbling up to the UI.
- **Safety.** No `eval`, no shell, no remote skill loading. File paths are
  canonicalized and verified to live under the sandbox before any read/write.

## License

MIT
