import { describe, expect, it } from "vitest";
import { placeBubble } from "./placement";

const layout = { bubbleW: 220, bubbleH: 64, margin: 8, gap: 10, tailInset: 18 };
const actions = { left: 12, top: 276, right: 352, bottom: 352 };
const chip = { left: 8, top: 8, right: 108, bottom: 40 };
const openPanel = { left: 0, top: 0, right: 360, bottom: 80 };
const viewport = { width: 360, height: 360 };

describe("placeBubble", () => {
  it("sits above the pet when there is room (unchanged behavior)", () => {
    const p = placeBubble({ pet: { x: 110, y: 125, size: 140 }, viewport, status: chip, actions, layout });
    expect(p.side).toBe("above");
    expect(p.top).toBe(125 - 64 - 10);
  });

  it("is never covered by the open status panel (QA s1-status-open)", () => {
    const p = placeBubble({ pet: { x: 110, y: 125, size: 140 }, viewport, status: openPanel, actions, layout });
    expect(p.top).toBeGreaterThanOrEqual(openPanel.bottom);
    expect(p.top + 64).toBeLessThanOrEqual(actions.top);
  });

  it("never sinks under the actions panel either", () => {
    const p = placeBubble({ pet: { x: 110, y: 90, size: 140 }, viewport, status: openPanel, actions, layout });
    expect(p.top).toBeGreaterThanOrEqual(openPanel.bottom);
    expect(p.top + 64).toBeLessThanOrEqual(actions.top);
  });
});
