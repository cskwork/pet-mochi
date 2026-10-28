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

/** `superseded`: the save failed, but a newer commit/edit owns every field
 *  in it, so this outcome changed nothing — the later commit reports. */
export type SaveResult =
  | { ok: true }
  | { ok: false; error: string; keys: string[]; superseded?: boolean };

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
  // Per-field versioning, so an outcome only touches a field it still owns:
  // `editVersion` bumps on every user edit (and every commit); `latestCommit`
  // is the sequence number of the newest queued commit of that field;
  // `pending` counts commits of that field still queued or in flight.
  const editVersion: Record<string, number> = {};
  const latestCommit: Record<string, number> = {};
  const pending: Record<string, number> = {};
  let seq = 0;

  /** Stamp per committed field: the commit's sequence + the field version. */
  type Stamp = Record<string, { seq: number; ver: number }>;

  /** True when this commit is still the last word on `k`: no newer commit
   *  was queued and the user hasn't edited the field since. */
  function owns(k: string, stamp: Stamp): boolean {
    const st = stamp[k];
    return !!st && latestCommit[k] === st.seq && (editVersion[k] ?? 0) === st.ver;
  }

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

  /** A user edit (e.g. typing) that isn't committed yet: any in-flight
   *  outcome for this field must leave it alone; its old error clears. */
  function noteEdit(key: keyof T & string) {
    editVersion[key] = (editVersion[key] ?? 0) + 1;
    clearError(key);
  }

  function clearError(key: keyof T & string) {
    if (!(key in errors)) return;
    const next = { ...errors };
    delete next[key];
    setErrors(next);
  }

  async function run(patch: Partial<T>, stamp: Stamp): Promise<SaveResult> {
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
        const b = before as Record<string, unknown>;
        for (const k of Object.keys(e)) {
          // Committed fields: adopt only while this commit still owns them.
          // Other fields: follow the echo unless the user changed them or a
          // commit for them is still pending.
          const adopt =
            k in stamp ? owns(k, stamp) : !(pending[k] > 0) && same(next[k], b[k]);
          if (adopt) next[k] = e[k];
        }
        deps.write(next as T);
      }
      const nextErrors = { ...errors };
      for (const k of keys) if (owns(k, stamp)) delete nextErrors[k];
      setErrors(nextErrors);
      deps.onSaved(echo);
      return { ok: true };
    } catch (err) {
      const msg = errorMessage(err);
      // Revert + flag only fields this commit still owns; a newer commit or
      // edit of the same field decides its final value and error.
      const owned = keys.filter((k) => owns(k, stamp));
      const cur = deps.read();
      if (cur && owned.length > 0) {
        const next = { ...cur } as Record<string, unknown>;
        const b = before as Record<string, unknown>;
        for (const k of owned) next[k] = b[k];
        deps.write(next as T);
      }
      if (owned.length > 0) {
        const nextErrors = { ...errors };
        for (const k of owned) nextErrors[k] = msg;
        setErrors(nextErrors);
      }
      return owned.length === 0 && keys.length > 0
        ? { ok: false, error: msg, keys: owned, superseded: true }
        : { ok: false, error: msg, keys: owned };
    }
  }

  function enqueue(patch: Partial<T>): Promise<SaveResult> {
    const stamp: Stamp = {};
    seq += 1;
    for (const k of Object.keys(patch)) {
      editVersion[k] = (editVersion[k] ?? 0) + 1;
      latestCommit[k] = seq;
      pending[k] = (pending[k] ?? 0) + 1;
      stamp[k] = { seq, ver: editVersion[k] };
    }
    const go = async () => {
      try {
        return await run(patch, stamp);
      } finally {
        for (const k of Object.keys(patch)) pending[k] -= 1;
      }
    };
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

  return { init, acknowledge, clearError, noteEdit, commit, commitDirty };
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
