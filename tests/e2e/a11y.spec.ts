import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, openPet, openSettings, statusChip, test } from "./fixtures";

/** axe violations of impact serious/critical, summarized for the failure message. */
async function seriousViolations(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

test("pet window: no serious/critical axe violations (default and status open)", async ({ page }) => {
  await openPet(page);
  expect(await seriousViolations(page), "default").toEqual([]);

  await statusChip(page).click();
  await expect(page.getByRole("complementary", { name: "Pet status" })).toBeVisible();
  expect(await seriousViolations(page), "status open").toEqual([]);
});

test("settings window: no serious/critical axe violations on any tab", async ({ page }) => {
  await openSettings(page, {
    settings: { developerEventLog: true },
    inbox: [{ name: "notes.txt", sizeBytes: 1200, modified: "2026-10-25T09:00:00Z" }],
  });
  for (const tab of ["General", "Memory", "Sandbox", "Developer"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tabpanel", { name: tab })).toBeVisible();
    expect(await seriousViolations(page), tab).toEqual([]);
  }
});
