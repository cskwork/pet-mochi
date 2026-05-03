import { describe, it, expect } from "vitest";
import { nextTrapIndex } from "./focusTrap";

describe("nextTrapIndex", () => {
  it("forward Tab from last wraps to first", () => {
    expect(nextTrapIndex({ currentIndex: 1, count: 2, shift: false })).toBe(0);
  });

  it("forward Tab from first does NOT wrap (lets browser advance normally inside the trap)", () => {
    expect(nextTrapIndex({ currentIndex: 0, count: 2, shift: false })).toBe(-1);
  });

  it("backward Shift+Tab from first wraps to last", () => {
    expect(nextTrapIndex({ currentIndex: 0, count: 2, shift: true })).toBe(1);
  });

  it("backward Shift+Tab from last does NOT wrap", () => {
    expect(nextTrapIndex({ currentIndex: 1, count: 2, shift: true })).toBe(-1);
  });

  it("returns -1 when current focus is outside the trap (-1 index)", () => {
    expect(nextTrapIndex({ currentIndex: -1, count: 2, shift: false })).toBe(-1);
    expect(nextTrapIndex({ currentIndex: -1, count: 2, shift: true })).toBe(-1);
  });

  it("returns -1 when count is 0 (nothing to trap to)", () => {
    expect(nextTrapIndex({ currentIndex: 0, count: 0, shift: false })).toBe(-1);
  });

  it("handles single-element trap: forward and backward both wrap to self (0)", () => {
    expect(nextTrapIndex({ currentIndex: 0, count: 1, shift: false })).toBe(0);
    expect(nextTrapIndex({ currentIndex: 0, count: 1, shift: true })).toBe(0);
  });

  it("handles 3-element trap: middle index lets the browser advance both directions", () => {
    expect(nextTrapIndex({ currentIndex: 1, count: 3, shift: false })).toBe(-1);
    expect(nextTrapIndex({ currentIndex: 1, count: 3, shift: true })).toBe(-1);
  });

  it("handles 3-element trap: edges wrap correctly", () => {
    expect(nextTrapIndex({ currentIndex: 2, count: 3, shift: false })).toBe(0);
    expect(nextTrapIndex({ currentIndex: 0, count: 3, shift: true })).toBe(2);
  });
});
