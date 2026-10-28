/**
 * Keyboard model for the pet's right-click menu (WAI-ARIA menu pattern).
 * DOM-free so it is unit-testable; Pet.svelte applies the result.
 */
export type MenuKeyResult = { type: "focus"; index: number } | { type: "close" } | null;

export function menuKeyTarget(key: string, current: number, count: number): MenuKeyResult {
  if (count <= 0) return key === "Escape" ? { type: "close" } : null;
  const cur = current < 0 ? -1 : current;
  switch (key) {
    case "Escape":
    case "Tab":
      return { type: "close" };
    case "ArrowDown":
      return { type: "focus", index: (cur + 1) % count };
    case "ArrowUp":
      return { type: "focus", index: cur <= 0 ? count - 1 : cur - 1 };
    case "Home":
      return { type: "focus", index: 0 };
    case "End":
      return { type: "focus", index: count - 1 };
    default:
      return null;
  }
}

/** True for the keys that open a context menu from the keyboard. */
export function isContextMenuKey(e: { key: string; shiftKey: boolean }): boolean {
  return e.key === "ContextMenu" || (e.shiftKey && e.key === "F10");
}
