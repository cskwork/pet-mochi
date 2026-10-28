import type { Page } from "@playwright/test";
import { anim, expect, openPet, petButton, test } from "./fixtures";

// Hover reaction (sim/hover.ts): one tiny local beat per cursor-enter, a 20 s
// cooldown, never while asleep, never an LLM call. Quiet personality: every
// reaction opens with "blush"; intensity 0 turns idle quirks off so nothing
// else holds the pose when the cursor arrives.
const QUIET = { personalityPreset: "quiet", animationIntensity: 0 };

const CALM_POSES = ["idle", "sit", "look_cursor", "walk"];

/** Leave the pet, enter it again, and report whether she blushed. The click-
 *  through poll (80 ms, mocked cursor_position) sees the enter edge. With
 *  `calm`, first assert she is in a pose that accepts a hover, so a missing
 *  reaction can only be the cooldown. */
async function hover(page: Page, calm = true): Promise<boolean> {
  const box = (await petButton(page).boundingBox())!;
  await page.mouse.move(box.x + box.width + 40, 4);
  await page.clock.runFor(300);
  if (calm) expect(CALM_POSES).toContain(await anim(page));
  const from = await page.evaluate(() => window.__qa.anims.length);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 3 });
  await page.clock.runFor(1_000);
  const poses = await page.evaluate((n) => window.__qa.anims.slice(n).map((a) => a.anim), from);
  return poses.includes("blush");
}

const now = (page: Page) => page.evaluate(() => Date.now());

test("one hover reaction, then a 20 s cooldown, then another; no LLM", async ({ page }) => {
  await openPet(page, { clock: true, settings: QUIET, pet: { energy: 90, boredom: 10, hunger: 10 } });
  // Boot plays stretch → wiggle and holds "wiggle" until the first 3 s tick
  // re-derives an idle pose; only calm poses take a hover reaction.
  await page.clock.runFor(3_500);
  const llmBefore = await page.evaluate(() => window.__qa.llmCalls.length);

  expect(await hover(page), "first hover reacts").toBe(true);
  const reactedAt = await now(page);

  await page.clock.runFor(3_000);
  expect(await hover(page), "re-hover after ~5 s: cooldown").toBe(false);

  await page.clock.runFor(15_000 - ((await now(page)) - reactedAt));
  expect(await hover(page), "re-hover after ~16 s: cooldown").toBe(false);

  await page.clock.runFor(21_000 - ((await now(page)) - reactedAt));
  expect(await hover(page), "re-hover after the 20 s cooldown reacts").toBe(true);

  expect(await page.evaluate(() => window.__qa.llmCalls.length)).toBe(llmBefore);
});

test("no hover reaction while asleep", async ({ page }) => {
  await openPet(page, { clock: true, settings: QUIET, pet: { energy: 5, boredom: 10, hunger: 10 } });
  await page.clock.runFor(4_000); // boot beat, then the first tick puts her to sleep
  expect(await anim(page)).toBe("sleep");
  const llmBefore = await page.evaluate(() => window.__qa.llmCalls.length);

  expect(await hover(page, false)).toBe(false);
  expect(await anim(page)).toBe("sleep");
  expect(await page.evaluate(() => window.__qa.llmCalls.length)).toBe(llmBefore);
});
