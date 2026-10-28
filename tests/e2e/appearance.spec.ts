import { ACCESSORY_STYLE, PET_SKINS, SKIN_FILTERS } from "../../src/lib/components/appearance";
import { actionButton, anim, expect, openPet, petButton, test } from "./fixtures";

// Skin/accessory follow settings:changed live (the settings window's broadcast).
const CALM = { energy: 95, boredom: 5, hunger: 5 };

test("each skin sets the sprite wrapper filter", async ({ page }) => {
  await openPet(page, { pet: CALM });
  const wrapper = petButton(page).locator(".skin");
  for (const skin of PET_SKINS) {
    await page.evaluate((petSkin) => window.__qa.fire("settings:changed", { petSkin }), skin);
    await expect(wrapper, skin).toHaveAttribute("style", `filter: ${SKIN_FILTERS[skin]};`);
    // ...and the browser applies it (computed value, not just the attribute).
    await expect(wrapper, skin).toHaveCSS("filter", skin === "classic" ? "none" : /^brightness\(/);
  }
});

test("an accessory renders on her head and is hidden while asleep", async ({ page }) => {
  await openPet(page, { clock: true, pet: { ...CALM, energy: 30 } });
  await page.evaluate(() => window.__qa.fire("settings:changed", { petAccessory: "crown" }));
  const accessory = petButton(page).locator(".accessory");
  await expect(accessory).toHaveText(ACCESSORY_STYLE.crown.glyph);
  await expect(accessory).toBeVisible();

  // Rest: yawn → sit → sleep; energy 55 < 60 keeps her asleep for a while.
  await actionButton(page, "Rest").click();
  await page.clock.runFor(1_500);
  expect(await anim(page)).toBe("sleep");
  await expect(accessory).toHaveCount(0);
});
