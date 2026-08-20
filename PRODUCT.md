# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Marketing landing page only: single-file static HTML/CSS/JS in `docs/`, zero
build step, deployed to GitHub Pages via a small GitHub Actions workflow.
(The product itself is a Tauri 2 desktop app — see Capabilities.)

## Users

Developers and enthusiasts arriving from the GitHub repo
(`cskwork/pet-mochi`). Their job: decide in under a minute whether this is
worth cloning — they want privacy/local-first credibility, a quickstart, and
proof the project is real (tests, architecture, roadmap).

## Product Purpose

Pet Mochi is a local-first AI digital pet that lives on the desktop. She
moves on her own, remembers what matters, and chats briefly through an
optional local LLM. Success for the page: a visitor clones the repo (and
stars it).

## Positioning

A deliberate middle path: alive **without** the LLM (deterministic local
simulation, 3s ticks, no network), LLM only at salience moments, memory you
can read and delete (SQLite + FTS5), sandboxed file access with per-file
consent. No accounts, no cloud, no telemetry. Neighboring products are either
chatbots wearing a mascot or cute shells with no memory.

## Operating Context

- Runs as a transparent, always-on-top, draggable desktop overlay
  (Windows / macOS / Linux via Tauri 2).
- Install: `git clone` → `npm install` → `npm run tauri:dev`.
- Optional chat: Ollama + small model (e.g. `gemma4:e2b`).
- Pet home sandbox: `inbox/`, `notes/`, `dreams/`, `exports/`, `mochi.db`.
- North Star quote: *"The pet must feel alive even when the LLM is off."*

## Capabilities and Constraints

- Tauri 2 + Svelte 5 + TypeScript frontend; Rust backend (rusqlite + FTS5,
  pluggable `LlmProvider` trait, Ollama first impl).
- 22+ sprite states, hand-drawn PNGs; mood tints + glyphs (🍡 hungry,
  … bored, ♡ lonely, ? curious).
- Tamagotchi-style actions (Feed with snack tray + hidden favorite, Play,
  Pat, Rest, Report), welcome-back rituals, keepsakes, drag physics,
  pick-up dangles, themed stage cards (cream/blossom/mint/night).
- 292 tests passing (213 frontend vitest + 79 backend cargo).
- MIT license. Repo: github.com/cskwork/pet-mochi.
- Out of scope for MVP (do not advertise as shipped): voice, 3D/Live2D,
  cloud sync, marketplace. Roadmap only.
- No packaged binaries are published yet — the page must not imply a
  one-click download/installer; the honest CTA is clone-and-run.

## Brand Commitments

- Name: **Pet Mochi** (🍡). The pet is "Mochi", referred to as "she".
- Hand-drawn sprite art (in `public/sprites/`) is the product's visual
  identity — the page must use the real sprites, not illustrations of them.
- Voice: warm, playful, technically honest. Cute surface, rigorous
  engineering underneath. Never overclaim (no fake testimonials, star
  counts, or user numbers).

## Evidence on Hand

- 27 real sprite PNGs in `public/sprites/` (idle, walk, jump, sit, sleep,
  eat variants, blush, hide, celebrate, peek, wiggle, dizzy, nuzzle, …).
- Real stats from the repo: 292 tests, 113 PRD requirements tracked,
  Tauri/Svelte/Rust stack, MIT license.
- Architecture table and sandbox guarantees documented in README.md.
- Absences future work must not fabricate: no testimonials, no user
  counts, no press, no packaged downloads.

## Product Principles

1. **Local-first, always** — no claim may imply cloud dependency; privacy
   is the default state, not a feature toggle.
2. **Alive without the LLM** — the deterministic simulation is the hero;
   the LLM is optional seasoning.
3. **Cute but credible** — charm draws the eye, engineering proof (tests,
   sandbox, memory ranking) closes the deal with developers.
4. **Honest CTAs** — only promise what exists today; roadmap is labeled
   as roadmap.
5. **The sprites are the brand** — real art assets lead every visual
   moment.

## Accessibility & Inclusion

Landing page must respect `prefers-reduced-motion` (sprite animations are
core to the page) and remain keyboard-navigable with visible focus states.
