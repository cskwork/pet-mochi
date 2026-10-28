import { actionButton, expect, openPet, petButton, test } from "./fixtures";

test("Shift+F10 opens the pet menu; arrows move; Escape returns focus to the pet", async ({ page }) => {
  await openPet(page);
  const pet = petButton(page);
  await pet.focus();
  await page.keyboard.press("Shift+F10");

  const menu = page.getByRole("menu", { name: "Mochi menu" });
  await expect(menu).toBeVisible();
  await expect(pet).toHaveAttribute("aria-expanded", "true");
  const settingsItem = menu.getByRole("menuitem", { name: "Settings…" });
  const closeItem = menu.getByRole("menuitem", { name: "Close Mochi" });
  await expect(settingsItem).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(closeItem).toBeFocused();
  await page.keyboard.press("ArrowDown"); // wraps
  await expect(settingsItem).toBeFocused();
  await page.keyboard.press("ArrowUp"); // wraps back
  await expect(closeItem).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(pet).toBeFocused();
  await expect(pet).toHaveAttribute("aria-expanded", "false");
  expect(await page.evaluate(() => window.__qa.calls.some((c) => c.cmd === "quit_app"))).toBe(false);
});

test("snack tray: focus lands on the first snack; Escape returns focus to Feed", async ({ page }) => {
  await openPet(page);
  const feed = actionButton(page, "Feed");
  const tray = page.getByRole("menu", { name: "Pick a snack for Mochi" });

  // Pointer open.
  await feed.click();
  await expect(tray).toBeVisible();
  await expect(feed).toHaveAttribute("aria-expanded", "true");
  await expect(tray.getByRole("menuitem", { name: "Feed Strawberry" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(tray).toBeHidden();
  await expect(feed).toBeFocused();
  await expect(feed).toHaveAttribute("aria-expanded", "false");

  // Keyboard open from the focused Feed button.
  await page.keyboard.press("Enter");
  await expect(tray.getByRole("menuitem", { name: "Feed Strawberry" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(tray).toBeHidden();
  await expect(feed).toBeFocused();
});
