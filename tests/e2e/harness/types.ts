/**
 * Shared types for the e2e fake backend (runs in the browser, see
 * `backend.ts`) and the Playwright helpers (`../fixtures.ts`).
 */
import type { InboxFile, Settings } from "../../../src/lib/bridge/api";
import type { PetState } from "../../../src/lib/sim/state";

export type { InboxFile, PetState, Settings };

/** Initial state + failure knobs. Serializable: it crosses into the page via
 *  `page.addInitScript`. Also mutable at runtime as `window.__qa.config`. */
export type HarnessConfig = {
  /** Overrides on the stored pet row returned by `get_pet_state`. */
  pet?: Partial<PetState>;
  /** Overrides on the stored settings returned by `get_settings`. */
  settings?: Partial<Settings>;
  /** Files listed by `list_inbox_files`. */
  inbox?: InboxFile[];
  /** When set, `save_settings` rejects with
   *  `start on login error: <message>` whenever `startOnLogin` flips
   *  (mirrors `AppError::Autostart` from the Rust command). */
  autostartError?: string | null;
  /** Commands that always reject with the given string. */
  reject?: Record<string, string>;
  /** Delay (ms) for the next `save_settings` calls, consumed one per call. */
  saveSettingsDelays?: number[];
};

export type RecordedCall = { t: number; cmd: string; args: unknown };
export type SettingsSave = { t: number; settings: Settings; rejected?: string };
export type AnimSample = { t: number; anim: string };

/** `window.__qa` — the fake backend's state and recordings. */
export type QaApi = {
  config: HarnessConfig;
  ready: boolean;
  pet: PetState;
  settings: Settings;
  calls: RecordedCall[];
  petSaves: { t: number; pet: PetState }[];
  settingsSaves: SettingsSave[];
  emits: { t: number; event: string; payload: unknown }[];
  llmCalls: RecordedCall[];
  windowCalls: RecordedCall[];
  /** Commands the fake backend does not implement (should stay empty). */
  unknown: Record<string, number>;
  /** Every `.mochi[data-anim]` change, in order. */
  anims: AnimSample[];
  /** Cursor position inside the page (drives the mocked cursor_position). */
  mouse: { x: number; y: number };
  /** Mocked outer window position (physical px, scale factor 1). */
  winPos: { x: number; y: number };
  /** Deliver a backend / cross-window event to this page's listeners. */
  fire: (event: string, payload: unknown) => number;
};

declare global {
  interface Window {
    __qa: QaApi;
    /** Installed by `mockIPC`; delivers event payloads to listen() handlers. */
    __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void };
    __QA_CONFIG__?: HarnessConfig;
    /** Optional Playwright binding: really resize the viewport on set_size. */
    qaResize?: (width: number, height: number) => Promise<void>;
  }
}
