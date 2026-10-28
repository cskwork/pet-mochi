import { describe, expect, it } from "vitest";
import { isContextMenuKey, menuKeyTarget } from "./menuNav";

describe("context menu keyboard model", () => {
  it("Escape and Tab close", () => {
    expect(menuKeyTarget("Escape", 0, 2)).toEqual({ type: "close" });
    expect(menuKeyTarget("Tab", 1, 2)).toEqual({ type: "close" });
  });

  it("arrows wrap, Home/End jump", () => {
    expect(menuKeyTarget("ArrowDown", 0, 2)).toEqual({ type: "focus", index: 1 });
    expect(menuKeyTarget("ArrowDown", 1, 2)).toEqual({ type: "focus", index: 0 });
    expect(menuKeyTarget("ArrowUp", 0, 2)).toEqual({ type: "focus", index: 1 });
    expect(menuKeyTarget("ArrowUp", -1, 2)).toEqual({ type: "focus", index: 1 });
    expect(menuKeyTarget("Home", 1, 2)).toEqual({ type: "focus", index: 0 });
    expect(menuKeyTarget("End", 0, 2)).toEqual({ type: "focus", index: 1 });
  });

  it("other keys are left alone (Enter/Space activate the button natively)", () => {
    expect(menuKeyTarget("Enter", 0, 2)).toBeNull();
    expect(menuKeyTarget("a", 0, 2)).toBeNull();
  });

  it("ContextMenu key and Shift+F10 open the menu", () => {
    expect(isContextMenuKey({ key: "ContextMenu", shiftKey: false })).toBe(true);
    expect(isContextMenuKey({ key: "F10", shiftKey: true })).toBe(true);
    expect(isContextMenuKey({ key: "F10", shiftKey: false })).toBe(false);
  });
});
