import { afterEach, describe, expect, it, vi } from "vitest";
import { createSettingsSaver, createStatusLine, errorMessage } from "./settingsSave";

type S = { a: number; b: string };

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("errorMessage", () => {
  it("uses Tauri's rejected string as-is and Error.message otherwise", () => {
    expect(errorMessage("login item failed")).toBe("login item failed");
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage(42)).toBe("42");
  });
});

describe("createSettingsSaver", () => {
  it("adopts the normalized echo when nothing changed meanwhile", async () => {
    let local: S = { a: 1, b: " Mochi " };
    const saver = createSettingsSaver<S>({
      read: () => ({ ...local }),
      write: (n) => (local = n),
      send: async (s) => ({ ...s, b: s.b.trim() }),
      onSaved: () => undefined,
    });
    expect(await saver.save()).toBeNull();
    expect(local).toEqual({ a: 1, b: "Mochi" });
  });

  it("never clobbers an edit made while the save was in flight", async () => {
    let local: S = { a: 1, b: "x" };
    const sends: S[] = [];
    const pending: Array<ReturnType<typeof deferred<S>>> = [];
    const saver = createSettingsSaver<S>({
      read: () => ({ ...local }),
      write: (n) => (local = n),
      send: (s) => {
        sends.push(s);
        const d = deferred<S>();
        pending.push(d);
        return d.promise;
      },
      onSaved: () => undefined,
    });
    const first = saver.save();
    await vi.waitFor(() => expect(sends.length).toBe(1)); // #1 is in flight
    local = { ...local, a: 2 }; // user toggles while save #1 is in flight
    const second = saver.save();
    await Promise.resolve();
    pending[0].resolve({ a: 1, b: "x" });
    await first;
    expect(local.a).toBe(2); // stale echo not adopted
    await vi.waitFor(() => expect(sends.length).toBe(2));
    expect(sends.map((s) => s.a)).toEqual([1, 2]); // serialized, newest sent
    pending[1].resolve({ a: 2, b: "x" });
    await second;
    expect(local).toEqual({ a: 2, b: "x" });
  });

  it("returns the backend's message on failure and keeps local values intact", async () => {
    let local: S = { a: 1, b: "http://10.0.0.5:11434" };
    const onSaved = vi.fn();
    const saver = createSettingsSaver<S>({
      read: () => ({ ...local }),
      write: (n) => (local = n),
      send: () => Promise.reject("local-only mode requires a loopback endpoint"),
      onSaved,
    });
    expect(await saver.save()).toBe("local-only mode requires a loopback endpoint");
    expect(local).toEqual({ a: 1, b: "http://10.0.0.5:11434" });
    expect(onSaved).not.toHaveBeenCalled();
    // A later save still runs after a failure.
    expect(await saver.save()).toBe("local-only mode requires a loopback endpoint");
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
