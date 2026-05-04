import { describe, it, expect } from "vitest";
import {
  shouldFireStatusReport,
  STATUS_REPORT_GATE_CONSTANTS,
  type StatusReportGateInput,
} from "./statusReportGate";

const NOW = Date.parse("2026-05-04T12:00:00Z");
const TWELVE_H_AGO = new Date(NOW - 12 * 60 * 60 * 1000).toISOString();
const SIX_H_AGO = new Date(NOW - 6 * 60 * 60 * 1000).toISOString();

function input(overrides: Partial<StatusReportGateInput> = {}): StatusReportGateInput {
  return {
    now: NOW,
    lastReportAt: TWELVE_H_AGO,
    createdAt: TWELVE_H_AGO,
    currentAnimation: "idle",
    idleSince: NOW - 90_000, // 90s ago: passes the 60s dwell
    inFlight: false,
    ...overrides,
  };
}

describe("shouldFireStatusReport — REQ-070..074", () => {
  it("fires when 12h elapsed AND idle AND dwelt 60s AND not in-flight", () => {
    expect(shouldFireStatusReport(input())).toBe(true);
  });

  it("does not fire when 12h has not elapsed since lastReportAt", () => {
    expect(shouldFireStatusReport(input({ lastReportAt: SIX_H_AGO }))).toBe(false);
  });

  it("does not fire while a multi-step action is in flight", () => {
    expect(shouldFireStatusReport(input({ inFlight: true }))).toBe(false);
  });

  it("does not fire when the pet is mid-animation (not idle/sleep)", () => {
    expect(shouldFireStatusReport(input({ currentAnimation: "celebrate" }))).toBe(false);
    expect(shouldFireStatusReport(input({ currentAnimation: "walk" }))).toBe(false);
    expect(shouldFireStatusReport(input({ currentAnimation: "eat" }))).toBe(false);
  });

  it("fires when the pet is asleep (sleep counts as an idle window)", () => {
    expect(shouldFireStatusReport(input({ currentAnimation: "sleep" }))).toBe(true);
  });

  it("does not fire when the idle dwell is shorter than 60s", () => {
    expect(shouldFireStatusReport(input({ idleSince: NOW - 30_000 }))).toBe(false);
  });

  it("falls back to createdAt when lastReportAt is null on first run", () => {
    // 12h since createdAt with no prior report → fires
    expect(
      shouldFireStatusReport(
        input({ lastReportAt: null, createdAt: TWELVE_H_AGO }),
      ),
    ).toBe(true);
    // 6h since createdAt → does not fire
    expect(
      shouldFireStatusReport(
        input({ lastReportAt: null, createdAt: SIX_H_AGO }),
      ),
    ).toBe(false);
  });

  it("does not fire when timestamps are unparseable garbage", () => {
    expect(
      shouldFireStatusReport(
        input({ lastReportAt: "not-an-iso", createdAt: "also-broken" }),
      ),
    ).toBe(false);
  });

  // REQ-074: no catch-up — the gate must NOT spam-fire while still inside the
  // same 12h window. Caller is responsible for stamping lastReportAt; the
  // gate cooperates by treating "still <12h since stamp" as a hard block.
  it("after lastReportAt is stamped, does not fire again until next 12h boundary (no catch-up)", () => {
    // Simulate: report just fired and stamped lastReportAt = NOW.
    const justStamped = new Date(NOW).toISOString();
    // 1 minute later, idle window still satisfied — must NOT fire.
    expect(
      shouldFireStatusReport(
        input({
          lastReportAt: justStamped,
          now: NOW + 60_000,
          idleSince: NOW + 60_000 - 90_000,
        }),
      ),
    ).toBe(false);
    // 11h59m later — still must NOT fire.
    expect(
      shouldFireStatusReport(
        input({
          lastReportAt: justStamped,
          now: NOW + 11 * 3600_000 + 59 * 60_000,
          idleSince: NOW + 11 * 3600_000 + 59 * 60_000 - 90_000,
        }),
      ),
    ).toBe(false);
    // 12h0m1s later — fires once.
    expect(
      shouldFireStatusReport(
        input({
          lastReportAt: justStamped,
          now: NOW + 12 * 3600_000 + 1_000,
          idleSince: NOW + 12 * 3600_000 + 1_000 - 90_000,
        }),
      ),
    ).toBe(true);
  });

  it("constants match REQ-070 wording", () => {
    expect(STATUS_REPORT_GATE_CONSTANTS.TWELVE_HOURS_MS).toBe(12 * 60 * 60 * 1000);
    expect(STATUS_REPORT_GATE_CONSTANTS.IDLE_DWELL_MS).toBe(60_000);
    expect(STATUS_REPORT_GATE_CONSTANTS.IDLE_STATES.has("idle")).toBe(true);
    expect(STATUS_REPORT_GATE_CONSTANTS.IDLE_STATES.has("sleep")).toBe(true);
    expect(STATUS_REPORT_GATE_CONSTANTS.IDLE_STATES.has("celebrate")).toBe(false);
  });
});
