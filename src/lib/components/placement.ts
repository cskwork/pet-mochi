/**
 * Speech-bubble placement around the pet (DOM-free, unit-tested). Prefers
 * above the pet, then below. When neither side fully clears the panels (e.g.
 * the status panel is open and Mochi sits mid-window), the bubble is clamped
 * into the free band between the status panel and the actions panel — it may
 * overlap the pet's head, but it is never hidden under a panel.
 */

export type Rect = { left: number; top: number; right: number; bottom: number };

export type BubbleLayout = {
  bubbleW: number;
  bubbleH: number;
  margin: number;
  gap: number;
  tailInset: number;
};

export function placeBubble(args: {
  pet: { x: number; y: number; size: number };
  viewport: { width: number; height: number };
  status: Rect;
  actions: Rect;
  layout: BubbleLayout;
}): { left: number; top: number; side: "above" | "below"; tailX: number } {
  const { pet, viewport, status, actions, layout: L } = args;
  const centerX = pet.x + pet.size / 2;
  const topClear = Math.max(L.margin, status.bottom + L.gap);
  const bottomClear = Math.min(viewport.height - L.margin, actions.top - L.gap);

  const aboveTop = pet.y - L.bubbleH - L.gap;
  const belowTop = pet.y + pet.size + L.gap;
  const aboveFits = aboveTop >= topClear;
  const belowFits = belowTop + L.bubbleH <= bottomClear;

  let placeBelow: boolean;
  let top: number;
  if (aboveFits) {
    placeBelow = false;
    top = aboveTop;
  } else if (belowFits) {
    placeBelow = true;
    top = belowTop;
  } else {
    // Neither side fully clears; pick the side with the most room and clamp
    // into the free band so no panel covers the bubble.
    const aboveRoom = pet.y - topClear;
    const belowRoom = bottomClear - (pet.y + pet.size);
    placeBelow = belowRoom > aboveRoom;
    const lo = topClear;
    const hi = Math.max(lo, bottomClear - L.bubbleH);
    top = Math.min(hi, Math.max(lo, placeBelow ? belowTop : aboveTop));
  }

  const left = Math.max(
    L.margin,
    Math.min(viewport.width - L.bubbleW - L.margin, centerX - L.bubbleW / 2),
  );
  const tailX = Math.max(L.tailInset, Math.min(L.bubbleW - L.tailInset, centerX - left));
  return { left, top, side: placeBelow ? "below" : "above", tailX };
}
