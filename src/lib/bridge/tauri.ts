/**
 * Thin wrapper around the tauri invoke API. Provides graceful fallbacks for the
 * pure-browser dev environment so vite preview / svelte-check don't break when
 * tauri is not present.
 */
import { invoke as rawInvoke } from "@tauri-apps/api/core";
import { listen as rawListen, type UnlistenFn } from "@tauri-apps/api/event";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!inTauri) {
    throw new Error(`tauri is not available in this context (cmd=${cmd})`);
  }
  return rawInvoke<T>(cmd, args);
}

export async function listen<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  if (!inTauri) {
    return async () => {};
  }
  return rawListen<T>(event, (e) => handler(e.payload));
}

export const isTauri = inTauri;
