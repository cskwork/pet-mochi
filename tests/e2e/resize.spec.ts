import type { Page } from "@playwright/test";
import { expect, openPet, overlaps, test, type Rect } from "./fixtures";

// Live size change (Settings → Size → settings:changed). At 1.5× the overlay
// grows by the pet's growth (360 → 430 px) and moves up by the same amount;
// she is re-placed around her feet. The window `resize` event may arrive
// after that placement ("late"), which once threw her to (0,0) (QA round 2).

type Snapshot = { pet: Rect; chip: Rect; actions: Rect; vw: number; vh: number; winY: number; feetY: number };

const snapshot = (page: Page): Promise<Snapshot> =>
  page.evaluate(() => {
    const rect = (sel: string) => {
      const b = document.querySelector(sel)!.getBoundingClientRect();
      return { l: b.left, t: b.top, r: b.right, b: b.bottom };
    };
    const pet = rect(".pet-anchor");
    const winY = window.__qa.winPos.y;
    return {
      pet,
      chip: rect(".status-chip"),
      actions: rect("nav.actions"),
      vw: innerWidth,
      vh: innerHeight,
      winY,
      feetY: winY + pet.b, // screen y of her feet
    };
  });

/** Record the pet's on-screen origin every animation frame. */
const startFrameTrace = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __frames: { l: number; t: number }[] };
    w.__frames = [];
    const sample = () => {
      const b = document.querySelector(".pet-anchor")!.getBoundingClientRect();
      w.__frames.push({ l: Math.round(b.left), t: Math.round(b.top) });
      requestAnimationFrame(sample);
    };
    sample();
  });

const framesAtOrigin = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __frames: { l: number; t: number }[] }).__frames.filter((f) => f.l === 0 && f.t === 0).length,
  );

for (const delivery of ["immediate", "late"] as const) {
  test(`petScale 1 → 1.5 → 1 keeps her feet put (resize event ${delivery})`, async ({ page }) => {
    // set_size → really resize the viewport, now or when the test says so.
    const pending: { width: number; height: number }[] = [];
    await page.exposeBinding("qaResize", async (_source, width: number, height: number) => {
      if (delivery === "immediate") await page.setViewportSize({ width, height });
      else pending.push({ width, height });
    });
    await openPet(page, { pet: { energy: 95, boredom: 5, hunger: 5 }, settings: { animationIntensity: 0 } });
    await expect.poll(async () => (await snapshot(page)).pet.l, "placed at mount").toBeGreaterThan(0);
    const start = await snapshot(page);
    await startFrameTrace(page);

    for (const scale of [1.5, 1]) {
      const size = Math.round(140 * scale);
      const height = 360 + (size - 140);
      await page.evaluate((petScale) => window.__qa.fire("settings:changed", { petScale }), scale);
      // The fit ran: pet resized and the window moved up/down by the growth.
      await expect
        .poll(async () => {
          const s = await snapshot(page);
          return { size: Math.round(s.pet.r - s.pet.l), winY: s.winY };
        })
        .toEqual({ size, winY: start.winY - (height - 360) });
      if (delivery === "late") {
        expect(await framesAtOrigin(page), "never at (0,0) before the resize event").toBe(0);
        expect(pending).toHaveLength(1);
        await page.setViewportSize(pending.shift()!);
      }
      await expect.poll(async () => (await snapshot(page)).vh).toBe(height);

      const s = await snapshot(page);
      const detail = JSON.stringify({ scale, start, now: s });
      expect(await framesAtOrigin(page), `never at (0,0) ${detail}`).toBe(0);
      expect(Math.abs(s.feetY - start.feetY), `feet stable ${detail}`).toBeLessThanOrEqual(2);
      expect(overlaps(s.pet, s.chip), `clear of status chip ${detail}`).toBe(false);
      expect(overlaps(s.pet, s.actions), `clear of actions ${detail}`).toBe(false);
      expect(s.pet.l >= 0 && s.pet.t >= 0 && s.pet.r <= s.vw && s.pet.b <= s.vh, `in view ${detail}`).toBe(true);
    }

    const end = await snapshot(page);
    expect(Math.abs(end.pet.l - start.pet.l)).toBeLessThanOrEqual(2);
    expect(Math.abs(end.pet.t - start.pet.t)).toBeLessThanOrEqual(2);
    expect(end.vh).toBe(start.vh);
  });
}
