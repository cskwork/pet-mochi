/**
 * REQ-124.2 — snack-tray composable extracted from Pet.svelte (pure move).
 * REQ-107 — the tray state machine: open/close, auto-close timeout, Escape
 * handling, focus management, and the favorite-discovered flag that keeps a
 * single session from writing the favorite memory twice. Pet.svelte keeps the
 * pick handler itself (it drives pet stats + animation playback).
 */
import { playSfx } from "../audio/sfx";

/** How long the tray stays open before auto-closing. */
export const SNACK_TRAY_TIMEOUT_MS = 8_000;
/** Tray footprint (px) — placement + click-through hit-testing. */
export const SNACK_TRAY_W = 232;
export const SNACK_TRAY_H = 66;

export function createSnackTray() {
  let open = $state(false);
  let trayEl = $state<HTMLDivElement | null>(null);
  // Plain on purpose — no template read; consulted on snack picks and on the
  // mount-time memory restore only.
  let favoriteDiscovered = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  function openTray() {
    open = true;
    playSfx("pop");
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      open = false;
      closeTimer = undefined;
    }, SNACK_TRAY_TIMEOUT_MS);
    // Move focus to the first snack so keyboard users land inside the menu
    // (and Escape-to-close works immediately).
    requestAnimationFrame(() => {
      trayEl?.querySelector<HTMLButtonElement>(".snack")?.focus();
    });
  }

  function close() {
    open = false;
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }

  function isFavoriteDiscovered(): boolean {
    return favoriteDiscovered;
  }

  function markFavoriteDiscovered(): void {
    favoriteDiscovered = true;
  }

  /** Mount-time restore from persisted memories (restart path). */
  function restoreFavorite(discovered: boolean): void {
    favoriteDiscovered = discovered;
  }

  /** Clear the auto-close timer on teardown. */
  function dispose() {
    if (closeTimer) clearTimeout(closeTimer);
  }

  return {
    get open() {
      return open;
    },
    get trayEl() {
      return trayEl;
    },
    set trayEl(el: HTMLDivElement | null) {
      trayEl = el;
    },
    openTray,
    close,
    onKey,
    isFavoriteDiscovered,
    markFavoriteDiscovered,
    restoreFavorite,
    dispose,
  };
}
