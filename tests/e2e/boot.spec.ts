import { actionButton, expect, openPet, petButton, statusChip, test } from "./fixtures";

test("pet window boots clean: sprite, status chip and actions panel visible", async ({ page, consoleIssues }) => {
  const failedRequests: string[] = [];
  page.on("response", (r) => {
    if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
  });
  await openPet(page);

  const sprite = petButton(page).locator("img.sprite");
  await expect(sprite).toBeVisible();
  await expect.poll(() => sprite.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  await expect(statusChip(page)).toBeVisible();
  const actions = page.getByRole("navigation", { name: "Pet actions" });
  await expect(actions).toBeVisible();
  for (const name of ["Feed", "Play", "Pat", "Rest"] as const) {
    await expect(actionButton(page, name)).toBeVisible();
  }
  await expect(actions.getByRole("button", { name: "Generate report" })).toBeVisible();

  // Every command the app sent at boot is one the fake backend implements.
  expect(await page.evaluate(() => window.__qa.unknown)).toEqual({});
  expect(failedRequests).toEqual([]);
  expect(consoleIssues).toEqual([]);
});
