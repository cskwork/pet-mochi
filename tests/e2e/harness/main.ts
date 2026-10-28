/**
 * Harness entry: install the fake backend, then boot the real app.
 * Pet window = empty hash; settings window = `#/settings`.
 */
import { installFakeBackend } from "./backend";

const isSettingsWindow = location.hash.replace(/^#/, "").startsWith("/settings");
const qa = installFakeBackend(window.__QA_CONFIG__ ?? {}, isSettingsWindow);

// A runtime specifier keeps tsc from type-checking the Svelte app through
// this file; Vite serves `/src/main.ts` like index.html does.
const appEntry = "/src/main.ts";
await import(/* @vite-ignore */ appEntry);
qa.ready = true;
