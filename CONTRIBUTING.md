# Contributing to Pet Mochi

Thanks for considering a contribution. Pet Mochi is a small, opinionated
project — the bar for accepted PRs is *clarity over cleverness* and *match
the spirit of the existing simulation-first design*.

> **Project North Star:** the pet must feel alive even when the LLM is off.

If your change makes Mochi *more* dependent on a network or LLM call to feel
alive, please discuss it in an issue first.

---

## Quick start

```bash
git clone https://github.com/cskwork/pet-mochi.git
cd pet-mochi
npm install
npm run tauri:dev          # the desktop pet, hot-reloaded
```

You need **Node ≥ 20** and **Rust ≥ 1.77**. Tauri builds the Rust backend on
first run (a few minutes); subsequent rebuilds are seconds.

---

## Before you open a PR

All four of these must pass locally:

```bash
npm test                                 # vitest — frontend simulation
npm run check                            # svelte-check — must be 0/0
cd src-tauri && cargo test --lib         # backend tests
cd src-tauri && cargo build              # confirms Rust compiles cleanly
```

For UI changes, **smoke-test in `npm run tauri:dev`** and describe what you
saw in the PR description. Type checking and unit tests verify code
correctness, not feature correctness — only the running app verifies that.

---

## Coding principles

**Simulation first.** Every behavior the user sees should work without an
LLM provider. The LLM is a quality lift on top of a complete simulation,
not a dependency.

**Small files, focused functions.** Keep modules under ~400 lines, functions
under ~50. Many small files > one large one.

**Pure functions in `src/lib/sim/`.** The simulation engine is intentionally
testable without DOM or Tauri. New behaviors there should come with tests.

**Surgical changes.** Don't refactor code you didn't have to touch. Match
existing style even if you'd write it differently.

**No dependencies on closed services or paid APIs** at the simulation layer.
LLM providers can be opt-in, but a user who declines should still get a
fully alive pet.

---

## What kinds of PRs we welcome

- 🐛 **Bug fixes** with a regression test that reproduces the bug.
- ✨ **New animation poses / sprite variants** — see `public/sprites/` and
  `src/lib/components/MochiSprite.svelte` `SRC` map.
- 🧠 **Better mood/decay tuning** — keep changes small and explain the
  rationale (e.g. user-tested for 30 minutes, observed X).
- 🔌 **New LLM providers** — implement the `LlmProvider` trait
  (`src-tauri/src/llm/provider.rs`) and wire it into `commands.rs`. Cloud
  providers must respect `local_only_mode`.
- 📚 **Documentation** — better explanations of mood thresholds, salience
  scoring, sandbox guarantees.
- 🌐 **Translation** — UI strings are currently English-only.

## What needs an issue first

- New top-level features (multiple pets, voice, 3D, plugins) — these affect
  the architecture and the PRD scope.
- Changes to the simulation tick rate, mood derivation, or salience
  thresholds — they shape the whole feel.
- Anything that adds a runtime dependency on the network for the core
  experience.

See [`PRD.md` §4.2](./PRD.md) for the explicit non-goals list.

---

## Commit message style

Conventional-ish, terse, focused on **why**:

```
feat(sprite): three new mood-distinguishing glyphs
fix(sim): round stats at persistence boundary so save survives decay
docs: clarify the inbox-consent flow
```

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`, `ci`.

Multi-paragraph commit bodies are fine and encouraged for non-trivial
changes — explain *why* the change was made, not just *what*.

---

## Pull-request template

A `.github/PULL_REQUEST_TEMPLATE.md` is loaded automatically. Fill in:

- **What changed** — one or two sentences.
- **Why** — link an issue if one exists, or describe the problem.
- **How tested** — `npm test` output + a short manual UI smoke-test note.
- **Screenshots/GIF** for visual changes.

---

## Code review

Every PR runs CI (vitest + cargo test + svelte-check) on Linux runners.
PRs cannot merge with a red CI.

A maintainer will review within a few days. Reviews focus on:

1. Does it match the simulation-first principle?
2. Is the diff surgical, or does it touch unrelated code?
3. Are there tests for new logic?
4. Does it preserve the privacy / local-first guarantees?

---

## AI coding agents (Claude Code, Codex, Cursor, etc.)

If you're using an AI coding agent, see [`AGENTS.md`](./AGENTS.md) for a
project-specific brief. PRs from AI-assisted contributors are welcome —
please **disclose the assistance** in the PR description and verify the
diff yourself before submitting.

---

## License

By contributing you agree your work will be licensed under the project's
[MIT License](./LICENSE).
