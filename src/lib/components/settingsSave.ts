/**
 * Settings-window save plumbing, kept DOM-free so it is unit-testable.
 *
 * - Saves are serialized: a second save waits for the first, so an older
 *   echo can never land after a newer one.
 * - The backend echo (normalized values) is adopted only when the user hasn't
 *   edited anything since that snapshot was sent; otherwise the local edits
 *   win and the next queued save sends them.
 * - Failures resolve to the backend's message (Tauri rejects with a string).
 */

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  const msg = (e as Error | null)?.message;
  return typeof msg === "string" && msg ? msg : String(e);
}

export type SettingsSaverDeps<T> = {
  /** Plain snapshot of the current local settings, or null if not loaded. */
  read: () => T | null;
  write: (next: T) => void;
  send: (snapshot: T) => Promise<T>;
  /** Called with the persisted echo after every successful save. */
  onSaved: (echo: T) => void;
};

export function createSettingsSaver<T>(deps: SettingsSaverDeps<T>) {
  let chain: Promise<unknown> = Promise.resolve();

  async function run(): Promise<string | null> {
    const sent = deps.read();
    if (sent === null) return "settings not loaded";
    const sentJson = JSON.stringify(sent);
    try {
      const echo = await deps.send(sent);
      if (JSON.stringify(deps.read()) === sentJson) deps.write(echo);
      deps.onSaved(echo);
      return null;
    } catch (e) {
      return errorMessage(e);
    }
  }

  /** Queue a save; resolves to null on success or the error message. */
  function save(): Promise<string | null> {
    const p = chain.then(run, run);
    chain = p;
    return p;
  }

  return { save };
}

/** One status line with a single timer: a new message cancels the previous
 *  message's clear-timer, so an older save can't blank a newer error. */
export function createStatusLine(set: (msg: string) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    show(msg: string, ms?: number) {
      if (timer) clearTimeout(timer);
      timer = undefined;
      set(msg);
      if (ms !== undefined) {
        timer = setTimeout(() => {
          timer = undefined;
          set("");
        }, ms);
      }
    },
    dispose() {
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
