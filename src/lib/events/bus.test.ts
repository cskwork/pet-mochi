import { beforeEach, describe, expect, it, vi } from "vitest";

const logEvent = vi.fn(() => Promise.resolve({}));
vi.mock("../bridge/api", () => ({
  api: { hasBackend: true, logEvent: (...a: unknown[]) => logEvent(...(a as [])) },
}));

import { eventBus } from "./bus";
import { _resetCooldowns, newPetState, salienceScore, shouldCallLLM } from "../sim";

describe("eventBus salience logging", () => {
  beforeEach(() => {
    _resetCooldowns();
    logEvent.mockClear();
  });

  it("logs a salient event once without consuming the shared LLM cooldown", () => {
    const pet = newPetState();
    const ev = { type: "STATUS_REPORT_DUE" } as const;
    eventBus.dispatch(ev, pet);
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith(ev.type, JSON.stringify(ev), salienceScore(ev, pet));
    // The cooldown is still fresh for the real (handler-side) gate.
    expect(shouldCallLLM(ev, pet)).toBe(true);
  });

  it("still logs when a handler already consumed the cooldown", () => {
    const pet = newPetState();
    const ev = { type: "STATUS_REPORT_DUE" } as const;
    const seen: boolean[] = [];
    const off = eventBus.subscribe((e, s) => seen.push(shouldCallLLM(e, s)));
    eventBus.dispatch(ev, pet);
    off();
    expect(seen).toEqual([true]);
    expect(logEvent).toHaveBeenCalledTimes(1);
  });

  it("does not log low-salience ticks", () => {
    eventBus.dispatch({ type: "IDLE_TICK" }, newPetState());
    expect(logEvent).not.toHaveBeenCalled();
  });
});
