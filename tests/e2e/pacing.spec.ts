import type { Page } from "@playwright/test";
import { actionButton, cursorAway, expect, openPet, statusChip, test } from "./fixtures";

// "Medium" needs pacing (BACKLOG #25, sim/decay.ts): hungry ~30 min after a
// feed, bored ~15 min after play. Driven by Playwright's fake clock.
test.describe.configure({ timeout: 180_000 });

const STEP_MS = 30_000;

/** Advance the clock until `mood` shows on the chip; returns minutes elapsed. */
async function minutesUntilMood(page: Page, mood: string, fromMin: number, maxMin: number): Promise<number | null> {
  for (let min = fromMin; min < maxMin; ) {
    await page.clock.runFor(STEP_MS);
    min += STEP_MS / 60_000;
    const name = await statusChip(page).getAttribute("aria-label");
    if (name?.startsWith(`${mood} `)) return min;
  }
  return null;
}

async function advanceMinutes(page: Page, minutes: number): Promise<void> {
  for (let i = 0; i < (minutes * 60_000) / STEP_MS; i++) await page.clock.runFor(STEP_MS);
}

test("hungry returns about 30 minutes after a feed", async ({ page }) => {
  await openPet(page, { clock: true, pet: { hunger: 76, boredom: 10, energy: 90 } });
  await expect(statusChip(page)).toHaveAccessibleName(/^hungry /);

  await actionButton(page, "Feed").click();
  await page.getByRole("menuitem", { name: "Feed Dango" }).click();
  await cursorAway(page);

  await advanceMinutes(page, 25);
  await expect(statusChip(page)).not.toHaveAccessibleName(/^hungry /);
  await expect(page.locator(".mark-hungry")).toHaveCount(0);

  const firstAt = await minutesUntilMood(page, "hungry", 25, 31);
  expect(firstAt, "hungry by 31 min").not.toBeNull();
  expect(firstAt!).toBeGreaterThanOrEqual(26);
  await expect(page.locator(".mark-hungry")).toHaveText("🍡");
});

test("bored returns about 15 minutes after Play", async ({ page }) => {
  await openPet(page, { clock: true, pet: { boredom: 71, hunger: 0, energy: 90 } });
  await expect(statusChip(page)).toHaveAccessibleName(/^bored /);

  await actionButton(page, "Play").click();
  await cursorAway(page);

  await advanceMinutes(page, 13);
  await expect(statusChip(page)).not.toHaveAccessibleName(/^bored /);

  const firstAt = await minutesUntilMood(page, "bored", 13, 17);
  expect(firstAt, "bored by 17 min").not.toBeNull();
  expect(firstAt!).toBeGreaterThanOrEqual(14);
  expect(firstAt!).toBeLessThanOrEqual(16);
});
