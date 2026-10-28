/**
 * Settings-window save plumbing, kept DOM-free so it is unit-testable.
 *
 * Every save is a *commit of specific fields*, captured when the change
 * happened (checkbox/select change, text-field blur, or the Save button):
 *
 * - What is sent is `persisted + this commit's fields`, never the live form,
 *   so half-typed text in another field is never persisted early, and a
 *   rejected value can't ride along in later saves.
 * - Saves are serialized; each builds on what the previous one persisted.
 * - On success the committed fields adopt the backend's normalized echo (if
 *   the user hasn't edited them since), untouched fields follow the echo too,
 *   and the fields' inline errors clear.
 * - On failure ONLY the committed fields revert to their last persisted value
 *   (if the user hasn't edited them since) and each gets the backend message
 *   as an inline error. Other fields and later saves are unaffected.
 */

export function errorMessage(e: unknown): string {
  if (typeof e === "string") return e;
  const msg = (e as Error | null)?.message;
  return typeof msg === "string" && msg ? msg : String(e);
}

export type FieldErrors = Record<string, string>;

export type SaveResult = { ok: true } | { ok: false; error: string; keys: string[] };

export type SettingsSaverDeps<T extends object> = {
  /** Plain snapshot of the current local (form) settings, or null if not loaded. */
  read: () => T | null;
  write: (next: T) => void;
  send: (full: T) => Promise<T>;
  /** Called with the persisted echo after every successful save. */
  onSaved: (echo: T) => void;
  /** Called whenever the per-field inline error map changes. */
  onErrors: (errors: FieldErrors) => void;
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function createSettingsSaver<T extends object>(deps: SettingsSaverDeps<T>) {
  let persisted: T | null = null;
  let errors: FieldErrors = {};
  let chain: Promise<unknown> = Promise.resolve();

  function setErrors(next: FieldErrors) {
    errors = next;
    deps.onErrors({ ...errors });
  }

  /** Adopt freshly loaded settings as the persisted baseline. */
  function init(loaded: T) {
    persisted = { ...loaded };
    setErrors({});
  }

  /** Record backend-side changes made outside save_settings (e.g. the API
   *  key flag) so later saves don't send a stale value. */
  function acknowledge(patch: Partial<T>) {
    if (persisted) persisted = { ...persisted, ...patch };
  }

  function clearError(key: keyof T & string) {
    if (!(key in errors)) return;
    const next = { ...errors };
    delete next[key];
    setErrors(next);
  }

  async function run(patch: Partial<T>): Promise<SaveResult> {
    const keys = Object.keys(patch);
    if (!persisted) return { ok: false, error: "settings not loaded", keys };
    const before = persisted;
    const sent = { ...before, ...patch } as T;
    try {
      const echo = await deps.send(sent);
      persisted = { ...echo };
      const cur = deps.read();
      if (cur) {
        const next = { ...cur } as Record<string, unknown>;
        const e = echo as Record<string, unknown>;
        const p = patch as Record<string, unknown>;
        const b = before as Record<string, unknown>;
        for (const k of Object.keys(e)) {
          const untouched = k in p ? same(next[k], p[k]) : same(next[k], b[k]);
          if (untouched) next[k] = e[k];
        }
        deps.write(next as T);
      }
      const nextErrors = { ...errors };
      for (const k of keys) delete nextErrors[k];
      setErrors(nextErrors);
      deps.onSaved(echo);
      return { ok: true };
    } catch (err) {
      const msg = errorMessage(err);
      const cur = deps.read();
      if (cur) {
        const next = { ...cur } as Record<string, unknown>;
        const p = patch as Record<string, unknown>;
        const b = before as Record<string, unknown>;
        for (const k of keys) if (same(next[k], p[k])) next[k] = b[k];
        deps.write(next as T);
      }
      const nextErrors = { ...errors };
      for (const k of keys) nextErrors[k] = msg;
      setErrors(nextErrors);
      return { ok: false, error: msg, keys };
    }
  }

  function enqueue(patch: Partial<T>): Promise<SaveResult> {
    const go = () => run(patch);
    const p = chain.then(go, go);
    chain = p;
    return p;
  }

  /** Commit these fields with their values RIGHT NOW (enqueue time). */
  function commit(...keys: (keyof T & string)[]): Promise<SaveResult> {
    const cur = deps.read();
    if (!cur) return Promise.resolve({ ok: false, error: "settings not loaded", keys });
    const patch: Partial<T> = {};
    for (const k of keys) patch[k] = cur[k];
    return enqueue(patch);
  }

  /** Save button: commit every field that differs from what is persisted. */
  function commitDirty(): Promise<SaveResult> {
    const cur = deps.read();
    if (!cur || !persisted) {
      return Promise.resolve({ ok: false, error: "settings not loaded", keys: [] });
    }
    const base = persisted as Record<string, unknown>;
    const c = cur as Record<string, unknown>;
    const keys = Object.keys(c).filter((k) => !same(c[k], base[k])) as (keyof T & string)[];
    return commit(...keys);
  }

  return { init, acknowledge, clearError, commit, commitDirty };
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
