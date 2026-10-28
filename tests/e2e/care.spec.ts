import { actionButton, anim, cursorAway, expect, openPet, statusChip, test } from "./fixtures";

test("Feed → snack tray → Dango saves hunger −35 and trust +1", async ({ page }) => {
  await openPet(page, { clock: true, pet: { hunger: 60, trust: 50, energy: 90, boredom: 10 } });

  await actionButton(page, "Feed").click();
  const tray = page.getByRole("menu", { name: "Pick a snack for Mochi" });
  await expect(tray).toBeVisible();
  await tray.getByRole("menuitem", { name: "Feed Dango" }).click();
  await expect(tray).toBeHidden();

  // The pet state is saved on a 4 s debounce.
  await page.clock.runFor(4_500);
  const saved = await page.evaluate(() => window.__qa.petSaves.at(-1)?.pet);
  expect(saved, "a save_pet_state after the snack").toBeDefined();
  expect(saved!.hunger).toBe(60 - 35);
  expect(saved!.trust).toBe(50 + 1);
});

test("Rest keeps her asleep across ticks until energy reaches 60", async ({ page }) => {
  await openPet(page, { clock: true, pet: { energy: 30, hunger: 10, boredom: 10 } });
  await statusChip(page).click();
  const energy = page.getByRole("progressbar", { name: "Energy" });
  await expect(energy).toBeVisible();

  await actionButton(page, "Rest").click();
  await cursorAway(page);
  // yawn → sit → sleep (2.1 s), then one 3 s sim tick per sample.
  const samples: { anim: string | undefined; energy: number }[] = [];
  for (let i = 0; i < 20; i++) {
    await page.clock.runFor(3_000);
    const sample = { anim: await anim(page), energy: Number(await energy.getAttribute("aria-valuenow")) };
    samples.push(sample);
    if (sample.anim !== "sleep") break;
  }

  const asleep = samples.filter((s) => s.anim === "sleep");
  expect(asleep.length, JSON.stringify(samples)).toBeGreaterThanOrEqual(3);
  for (const s of samples) {
    if (s.energy < 60) expect(s.anim, JSON.stringify(samples)).toBe("sleep");
  }
  const woke = samples.at(-1)!;
  expect(woke.anim, JSON.stringify(samples)).not.toBe("sleep");
  expect(woke.energy).toBeGreaterThanOrEqual(60);
});
