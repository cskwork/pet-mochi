<!--
Thanks for sending a PR! Please fill in the sections below — they help
reviewers focus and protect against regressions.

For a project-wide brief see CONTRIBUTING.md (humans) or AGENTS.md (AI agents).
-->

## What changed

<!-- 1–2 sentences: what does this PR do? -->

## Why

<!-- Link to an issue (`Closes #NN`) or describe the problem this solves. -->

## How tested

- [ ] `npm test` — all passing
- [ ] `npm run check` — 0 errors / 0 warnings
- [ ] `cd src-tauri && cargo test --lib` — all passing
- [ ] Manual smoke-test in `npm run tauri:dev` (describe what you observed):
  <!-- e.g. "Patted Mochi while sleeping → saw yawn → blush → celebrate." -->

## Screenshots / GIF

<!-- Required for visual changes. Attach a PNG or short MP4/GIF. -->

## Checklist

- [ ] Diff is surgical — only files I had to change
- [ ] New logic has a unit test (if it's in `src/lib/sim/` or a Rust module)
- [ ] No new runtime dependency on a network or paid service for core behavior
- [ ] Updated `BACKLOG.md` / `DECISIONS.md` if the change closes an item
- [ ] AI assistance disclosed (if applicable) — see AGENTS.md
