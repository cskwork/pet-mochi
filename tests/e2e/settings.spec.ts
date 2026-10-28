import type { Page } from "@playwright/test";
import { expect, openSettings, test } from "./fixtures";
import type { Settings } from "./harness/types";

// Settings saving (components/settingsSave.ts): every checkbox/select saves
// on change, text fields on blur; a rejected field reverts with an inline
// role=alert error; saves are serialized and never carry half-typed text.

const saveCount = (page: Page) => page.evaluate(() => window.__qa.settingsSaves.length);
const lastSaved = (page: Page) => page.evaluate(() => window.__qa.settingsSaves.at(-1)?.settings);
const emitCount = (page: Page) =>
  page.evaluate(() => window.__qa.emits.filter((e) => e.event === "settings:changed").length);
const persisted = (page: Page) => page.evaluate(() => window.__qa.settings);

const checkbox = (page: Page, name: RegExp) => page.getByRole("checkbox", { name });
const select = (page: Page, name: RegExp) => page.getByRole("combobox", { name });
const textbox = (page: Page, name: RegExp) => page.getByRole("textbox", { name });

const CHECKBOXES = [
  [/^Local-only mode/, "localOnlyMode"],
  [/^Allow autonomous chat bubbles/, "autonomousSpeech"],
  [/^Sound effects/, "soundEffects"],
  [/^Desktop notifications/, "desktopNotifications"],
  [/^Memory enabled/, "memoryEnabled"],
  [/^Always on top/, "alwaysOnTop"],
  [/^Start on login/, "startOnLogin"],
  [/^Developer event log/, "developerEventLog"],
] as const;

const SELECTS = [
  [/^Personality/, "personalityPreset", "lazy"],
  [/^Accessory/, "petAccessory", "crown"],
  [/^Stage background/, "stageBackground", "mint"],
  [/^LLM provider/, "llmProvider", "none"],
] as const;

test("each checkbox and select saves exactly once per change", async ({ page }) => {
  await openSettings(page);
  let changes = 0;
  const expectOneSave = async (key: keyof Settings, value: unknown) => {
    changes += 1;
    await expect.poll(() => saveCount(page), key).toBe(changes);
    expect((await lastSaved(page))?.[key], key).toEqual(value);
    expect(await emitCount(page), `${key} broadcast once`).toBe(changes);
  };

  for (const [name, key] of CHECKBOXES) {
    const box = checkbox(page, name);
    const before = await box.isChecked();
    await box.click();
    await expect(box).toBeChecked({ checked: !before });
    await expectOneSave(key, !before);
  }
  for (const [name, key, value] of SELECTS) {
    await select(page, name).selectOption(value);
    await expectOneSave(key, value);
  }
  expect(await saveCount(page)).toBe(CHECKBOXES.length + SELECTS.length);
});

test("text fields save on blur only, not per keystroke", async ({ page }) => {
  await openSettings(page);
  const fields = [
    [/^Pet name/, "petName", "Pochiko"],
    [/^Ollama endpoint/, "ollamaEndpoint", "http://127.0.0.1:11435"],
    [/^Ollama model/, "ollamaModel", "gemma4:e4b"],
  ] as const;
  for (const [name, key, value] of fields) {
    const input = textbox(page, name);
    const before = await saveCount(page);
    await input.click();
    await input.press("ControlOrMeta+a");
    await input.pressSequentially(value);
    await expect(input).toHaveValue(value);
    expect(await saveCount(page), `${key}: no save while typing`).toBe(before);

    await input.press("Tab");
    await expect.poll(() => saveCount(page), `${key}: one save on blur`).toBe(before + 1);
    expect((await lastSaved(page))?.[key]).toBe(value);

    // Focusing and leaving again without an edit saves nothing.
    await input.focus();
    await input.press("Tab");
    expect(await saveCount(page), `${key}: no save on a no-op blur`).toBe(before + 1);
  }
});

test("local-only + remote endpoint: inline alert, field reverts, later saves stay valid", async ({ page }) => {
  await openSettings(page);
  const endpoint = textbox(page, /^Ollama endpoint/);
  await endpoint.fill("http://10.0.0.5:11434");
  await endpoint.press("Tab");

  const alert = page.getByRole("alert");
  await expect(alert).toHaveCount(1);
  await expect(alert).toHaveText(/^Not saved: .*local-only mode requires a loopback Ollama endpoint/);
  await expect(endpoint).toHaveAttribute("aria-invalid", "true");
  await expect(endpoint).toHaveAccessibleDescription(/local-only mode requires a loopback/);
  await expect(endpoint).toHaveValue("http://localhost:11434");
  expect((await persisted(page)).ollamaEndpoint).toBe("http://localhost:11434");

  await select(page, /^Stage background/).selectOption("mint");
  await expect.poll(async () => (await persisted(page)).stageBackground).toBe("mint");
  const saves = await page.evaluate(() => window.__qa.settingsSaves);
  expect(saves.at(-1)?.rejected).toBeUndefined();
  expect(saves.at(-1)?.settings.ollamaEndpoint).toBe("http://localhost:11434");
  expect((await persisted(page)).ollamaEndpoint).toBe("http://localhost:11434");
});

test("Start on login rejected by the backend: inline error and the box reverts", async ({ page }) => {
  await openSettings(page, { autostartError: "could not enable: mock LaunchAgent failure" });
  const box = checkbox(page, /^Start on login/);
  await expect(box).not.toBeChecked();
  await box.click();

  const alert = page.getByRole("alert");
  await expect(alert).toHaveCount(1);
  await expect(alert).toHaveText("Not saved: start on login error: could not enable: mock LaunchAgent failure");
  await expect(box).toHaveAccessibleDescription(/start on login error/);
  await expect(box).toHaveAttribute("aria-invalid", "true");
  await expect(box).not.toBeChecked();
  expect((await persisted(page)).startOnLogin).toBe(false);
});

test("a slow in-flight save never sends half-typed text", async ({ page }) => {
  await openSettings(page, { clock: true });
  await page.evaluate(() => {
    window.__qa.config.saveSettingsDelays = [1_600]; // the next save is slow
  });
  const accessory = select(page, /^Accessory/);
  const personality = select(page, /^Personality/);
  const name = textbox(page, /^Pet name/);

  await accessory.selectOption("bow"); // save #1, in flight
  await personality.selectOption("lazy"); // save #2, queued behind #1
  await name.click();
  await name.press("ControlOrMeta+a");
  await name.pressSequentially("Typing"); // no blur yet
  expect(await saveCount(page)).toBe(1);

  await page.clock.runFor(2_000); // #1 resolves, #2 runs
  await expect.poll(() => saveCount(page)).toBe(2);
  await expect.poll(async () => (await persisted(page)).personalityPreset).toBe("lazy");
  const sent = await page.evaluate(() => window.__qa.settingsSaves.map((s) => s.settings));
  expect(sent.map((s) => s.petName)).toEqual(["Mochi", "Mochi"]);
  expect(sent[1].petAccessory).toBe("bow");
  expect(await persisted(page)).toMatchObject({ petName: "Mochi", petAccessory: "bow", personalityPreset: "lazy" });
  // The echoes did not clobber the newer UI state.
  await expect(name).toHaveValue("Typing");
  await expect(name).toBeFocused();
  await expect(accessory).toHaveValue("bow");
  await expect(personality).toHaveValue("lazy");

  await name.press("Tab"); // blur commits the name once
  await expect.poll(() => saveCount(page)).toBe(3);
  expect(await lastSaved(page)).toMatchObject({ petName: "Typing", petAccessory: "bow", personalityPreset: "lazy" });
});
