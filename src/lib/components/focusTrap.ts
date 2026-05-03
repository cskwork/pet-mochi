/**
 * Pure focus-trap arithmetic. Given the currently focused element's index
 * within the trap's focusable list, decide where focus should jump on Tab /
 * Shift+Tab. Returning -1 means "no override — let the browser do its thing"
 * (the natural Tab order stays inside the trap for non-edge moves).
 *
 * Edge wraps:
 *   - forward Tab on the LAST element  → 0          (wrap to first)
 *   - Shift+Tab on the FIRST element   → count-1    (wrap to last)
 *   - any move when current is outside (-1)         → -1 (no override)
 *   - count === 0                                   → -1
 *   - count === 1                                   → 0  (wrap to self)
 */
export function nextTrapIndex(args: {
  currentIndex: number;
  count: number;
  shift: boolean;
}): number {
  const { currentIndex, count, shift } = args;
  if (count <= 0) return -1;
  if (currentIndex < 0) return -1;
  if (count === 1) return 0;
  if (shift && currentIndex === 0) return count - 1;
  if (!shift && currentIndex === count - 1) return 0;
  return -1;
}
