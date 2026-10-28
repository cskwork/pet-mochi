/**
 * Playwright helpers for the harness page (tests/e2e/harness.html): open the
 * pet or settings window on the fake backend with a given config, and fail
 * any test that logs a console error/warning or throws a page error.
 */
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import type { HarnessConfig } from "./harness/types";

export { expect };

const HARNESS = "/tests/e2e/harness.html";

/** Local daytime, so time-of-day rituals and night sleep stay out of the way. */
export const FIXED_TIME = new Date("2026-10-28T10:00:00");

export type OpenOptions = HarnessConfig & {
  /** Install Playwright's fake clock before navigation (`true` = FIXED_TIME). */
  clock?: boolean;
};

export const test = base.extend<{ consoleIssues: string[] }>({
  consoleIssues: [
    async ({ page }, use) => {
      const issues: string[] = [];
      page.on("console", (m) => {
        if (m.type() === "error" || m.type() === "warning") issues.push(`${m.type()}: ${m.text()}`);
      });
      page.on("pageerror", (e) => issues.push(`pageerror: ${e.message}`));
      await use(issues);
      expect(issues, "console errors / warnings / page errors").toEqual([]);
    },
    { auto: true },
  ],
});

async function open(page: Page, hash: string, opts: OpenOptions): Promise<void> {
  const { clock, ...config } = opts;
  await page.addInitScript((cfg) => {
    window.__QA_CONFIG__ = cfg;
  }, config);
  if (clock) await page.clock.install({ time: FIXED_TIME });
  await page.goto(HARNESS + hash);
  await page.waitForFunction(() => window.__qa?.ready === true);
}

/** Pet overlay window (360×360 viewport, as in tauri.conf.json). */
export async function openPet(page: Page, opts: OpenOptions = {}): Promise<void> {
  await open(page, "", opts);
  // onMount places her once the backend state loaded.
  await expect(petButton(page)).toBeVisible();
}

/** Settings window (#/settings), General tab loaded. */
export async function openSettings(page: Page, opts: OpenOptions = {}): Promise<void> {
  await page.setViewportSize({ width: 520, height: 640 });
  await open(page, "#/settings", opts);
  await expect(page.getByRole("tabpanel", { name: "General" })).toBeVisible();
}

export const petButton = (page: Page): Locator =>
  page.getByRole("button", { name: "Mochi", exact: true });

export const actionButton = (page: Page, name: "Feed" | "Play" | "Pat" | "Rest"): Locator =>
  page.getByRole("navigation", { name: "Pet actions" }).getByRole("button", { name, exact: true });

export const statusChip = (page: Page): Locator =>
  page.getByRole("button", { name: /show status$/ });

/** The sprite's current pose (`.mochi[data-anim]`). */
export const anim = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => document.querySelector<HTMLElement>(".mochi")?.dataset.anim);

/** Park the mocked global cursor far from the overlay. */
export async function cursorAway(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__qa.mouse = { x: -2000, y: -2000 };
  });
}

export type Rect = { l: number; t: number; r: number; b: number };

export function overlaps(a: Rect | null, b: Rect | null): boolean {
  return !!a && !!b && a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
}

/** Bounding rect of the first element matching `selector`, or null. */
export const rectOf = (page: Page, selector: string): Promise<Rect | null> =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { l: b.left, t: b.top, r: b.right, b: b.bottom };
  }, selector);
