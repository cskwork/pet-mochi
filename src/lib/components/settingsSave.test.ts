import { afterEach, describe, expect, it, vi } from "vitest";
import { createSettingsSaver, createStatusLine, errorMessage } from "./settingsSave";

describe("errorMessage", () => {
  it("uses Tauri's rejected string as-is and Error.message otherwise", () => {
    expect(errorMessage("login item failed")).toBe("login item failed");
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage(42)).toBe("42");
  });
});

type F = { localOnly: boolean; endpoint: string; stage: string; model: string };

/** Fake backend mirroring the real validation: local-only needs loopback. */
function fakeBackend(initial: F, delay?: Promise<void>) {
  let stored = { ...initial };
  const sends: F[] = [];
  const send = async (full: F): Promise<F> => {
    sends.push({ ...full });
    if (delay) await delay;
    if (full.localOnly && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(full.endpoint)) {
      throw "local-only mode requires a loopback Ollama endpoint";
    }
    stored = { ...full, model: full.model.trim() };
    return { ...stored };
  };
  return { send, sends, stored: () => stored };
}

function setup(initial: F, delay?: Promise<void>) {
  let local: F = { ...initial };
  let errors: Record<string, string> = {};
  const backend = fakeBackend(initial, delay);
  const saver = createSettingsSaver<F>({
    read: () => ({ ...local }),
    write: (n) => (local = n),
    send: backend.send,
    onSaved: () => undefined,
    onErrors: (e) => (errors = e),
  });
  saver.init(initial);
  return {
    saver,
    backend,
    get local() {
      return local;
    },
    set local(v: F) {
      local = v;
    },
    get errors() {
      return errors;
    },
  };
}

const BASE: F = { localOnly: true, endpoint: "http://localhost:11434", stage: "transparent", model: "gemma" };

describe("createSettingsSaver — per-field commits", () => {
  it("a rejected save reverts ONLY the triggering field and shows its inline error", async () => {
    const t = setup(BASE);
    t.local = { ...t.local, endpoint: "http://10.0.0.5:11434", model: "half-typ" }; // model not committed
    const res = await t.saver.commit("endpoint");
    expect(res).toEqual({
      ok: false,
      error: "local-only mode requires a loopback Ollama endpoint",
      keys: ["endpoint"],
    });
    expect(t.local.endpoint).toBe(BASE.endpoint); // reverted to persisted
    expect(t.local.model).toBe("half-typ"); // untouched
    expect(t.errors).toEqual({ endpoint: "local-only mode requires a loopback Ollama endpoint" });
  });

  it("the next unrelated save persists (no poisoned payload)", async () => {
    const t = setup(BASE);
    t.local = { ...t.local, endpoint: "http://10.0.0.5:11434" };
    await t.saver.commit("endpoint");
    t.local = { ...t.local, stage: "cream" };
    expect(await t.saver.commit("stage")).toEqual({ ok: true });
    expect(t.backend.stored().stage).toBe("cream");
    expect(t.backend.stored().endpoint).toBe(BASE.endpoint);
    // The endpoint error stays until that field is edited or saved.
    expect(t.errors.endpoint).toBeDefined();
    t.saver.clearError("endpoint");
    expect(t.errors).toEqual({});
  });

  it("turning Local-only on with a remote endpoint reverts the checkbox", async () => {
    const t = setup({ ...BASE, localOnly: false, endpoint: "http://10.0.0.5:11434" });
    t.local = { ...t.local, localOnly: true };
    const res = await t.saver.commit("localOnly");
    expect(res.ok).toBe(false);
    expect(t.local.localOnly).toBe(false);
    expect(t.backend.stored().localOnly).toBe(false);
    expect(Object.keys(t.errors)).toEqual(["localOnly"]);
  });

  it("a field's inline error clears when that field next saves successfully", async () => {
    const t = setup(BASE);
    t.local = { ...t.local, endpoint: "http://10.0.0.5:11434" };
    await t.saver.commit("endpoint");
    t.local = { ...t.local, endpoint: "http://127.0.0.1:11434" };
    expect((await t.saver.commit("endpoint")).ok).toBe(true);
    expect(t.errors).toEqual({});
  });

  it("adopts the backend's normalized value for the committed field", async () => {
    const t = setup(BASE);
    t.local = { ...t.local, model: "  llama  " };
    await t.saver.commit("model");
    expect(t.local.model).toBe("llama");
  });

  it("a queued save never sends half-typed text from another field", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = setup(BASE, gate);
    t.local = { ...t.local, stage: "cream" };
    const first = t.saver.commit("stage"); // in flight (delayed)
    t.local = { ...t.local, localOnly: false };
    const second = t.saver.commit("localOnly"); // queued; value captured now
    t.local = { ...t.local, model: "gem" }; // typing, not blurred yet
    release();
    await first;
    await second;
    expect(t.backend.sends.map((x) => x.model)).toEqual(["gemma", "gemma"]);
    expect(t.backend.sends[1]).toMatchObject({ stage: "cream", localOnly: false });
    expect(t.local.model).toBe("gem"); // the typing survives both echoes
  });

  it("the Save button commits every dirty field", async () => {
    const t = setup(BASE);
    t.local = { ...t.local, stage: "mint", model: "qwen" };
    expect((await t.saver.commitDirty()).ok).toBe(true);
    expect(t.backend.stored()).toMatchObject({ stage: "mint", model: "qwen" });
  });
});

type N = { petName: string; stage: string };

/** Backend whose every call is settled by hand, to force overlap orders. */
function manualBackend() {
  const calls: Array<{
    sent: N;
    resolve: (v: N) => void;
    reject: (e: unknown) => void;
  }> = [];
  const send = (full: N) =>
    new Promise<N>((resolve, reject) => calls.push({ sent: { ...full }, resolve, reject }));
  return { send, calls };
}

function setupManual() {
  let local: N = { petName: "Mochi", stage: "transparent" };
  let errors: Record<string, string> = {};
  const backend = manualBackend();
  const saver = createSettingsSaver<N>({
    read: () => ({ ...local }),
    write: (n) => (local = n),
    send: backend.send,
    onSaved: () => undefined,
    onErrors: (e) => (errors = e),
  });
  saver.init({ ...local });
  return {
    saver,
    backend,
    get local() {
      return local;
    },
    set local(v: N) {
      local = v;
    },
    get errors() {
      return errors;
    },
  };
}

async function waitCalls(t: ReturnType<typeof setupManual>, n: number) {
  await vi.waitFor(() => expect(t.backend.calls.length).toBe(n));
}

describe("createSettingsSaver — overlapping commits of the same field", () => {
  it("(a) fail-then-succeed: the form ends on the saved value with no error", async () => {
    const t = setupManual();
    t.saver.noteEdit("petName");
    t.local = { ...t.local, petName: "Momo" };
    const auto = t.saver.commit("petName"); // blur auto-save, in flight
    await waitCalls(t, 1);
    const button = t.saver.commitDirty(); // Save pressed: same field, same value
    t.backend.calls[0].reject("disk busy");
    const r1 = await auto;
    expect(r1).toMatchObject({ ok: false, superseded: true });
    expect(t.local.petName).toBe("Momo"); // no rollback: a newer commit owns it
    expect(t.errors).toEqual({});
    await waitCalls(t, 2);
    expect(t.backend.calls[1].sent.petName).toBe("Momo");
    t.backend.calls[1].resolve({ ...t.backend.calls[1].sent });
    expect(await button).toEqual({ ok: true }); // → "saved ✓"
    expect(t.local.petName).toBe("Momo");
    expect(t.errors).toEqual({});
  });

  it("(b) fail-then-fail: reverted to the persisted value with the error", async () => {
    const t = setupManual();
    t.local = { ...t.local, petName: "Momo" };
    const auto = t.saver.commit("petName");
    await waitCalls(t, 1);
    const button = t.saver.commitDirty();
    t.backend.calls[0].reject("disk busy");
    await auto;
    await waitCalls(t, 2);
    t.backend.calls[1].reject("still busy");
    expect(await button).toMatchObject({ ok: false, keys: ["petName"] });
    expect(t.local.petName).toBe("Mochi");
    expect(t.errors).toEqual({ petName: "still busy" });
  });

  it("(c) an edit after the enqueue survives either outcome", async () => {
    for (const outcome of ["resolve", "reject"] as const) {
      const t = setupManual();
      t.local = { ...t.local, petName: "Momo" };
      const auto = t.saver.commit("petName");
      await waitCalls(t, 1);
      t.saver.noteEdit("petName"); // user keeps typing, not blurred yet
      t.local = { ...t.local, petName: "Momoko" };
      if (outcome === "resolve") t.backend.calls[0].resolve({ ...t.backend.calls[0].sent });
      else t.backend.calls[0].reject("nope");
      await auto;
      expect(t.local.petName, outcome).toBe("Momoko");
      expect(t.errors, outcome).toEqual({});
    }
  });

  it("an unrelated field still follows the echo while another commit is pending", async () => {
    const t = setupManual();
    t.local = { ...t.local, stage: "cream" };
    const first = t.saver.commit("stage");
    await waitCalls(t, 1);
    t.backend.calls[0].resolve({ ...t.backend.calls[0].sent, stage: "cream" });
    expect(await first).toEqual({ ok: true });
    expect(t.local.stage).toBe("cream");
  });
});

describe("createStatusLine", () => {
  afterEach(() => vi.useRealTimers());

  it("a newer message cancels the older clear-timer", () => {
    vi.useFakeTimers();
    let text = "";
    const line = createStatusLine((m) => (text = m));
    line.show("saved ✓", 2_000);
    vi.advanceTimersByTime(1_200);
    line.show("error: login item failed", 5_000);
    vi.advanceTimersByTime(1_000); // the first timer would have fired here
    expect(text).toBe("error: login item failed");
    vi.advanceTimersByTime(4_000);
    expect(text).toBe("");
  });
});
