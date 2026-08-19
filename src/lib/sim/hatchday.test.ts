import { describe, expect, it } from "vitest";
import {
  hasCelebratedHatchdayThisYear,
  HATCHDAY_MEMORY_MARKER,
  HATCHDAY_MEMORY_TYPE,
  hatchdayBubble,
  hatchdayMemoryContent,
  hatchdayStatus,
} from "./hatchday";

// Local-time constructor so month/day matching mirrors the runtime, which
// also uses local Date fields.
const local = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12, 0, 0);

describe("REQ-110 hatchday status", () => {
  const CREATED = local(2025, 8, 19).toISOString();

  it("full anniversary → yearly, with age in years", () => {
    const s = hatchdayStatus(CREATED, local(2026, 8, 19));
    expect(s.yearly).toBe(true);
    expect(s.monthly).toBe(false);
    expect(s.ageYears).toBe(1);
  });

  it("same day-of-month in another month → monthly only", () => {
    const s = hatchdayStatus(CREATED, local(2026, 3, 19));
    expect(s.yearly).toBe(false);
    expect(s.monthly).toBe(true);
  });

  it("any other day → neither", () => {
    const s = hatchdayStatus(CREATED, local(2026, 8, 20));
    expect(s.yearly).toBe(false);
    expect(s.monthly).toBe(false);
  });

  it("the creation day itself is not an anniversary", () => {
    const s = hatchdayStatus(CREATED, local(2025, 8, 19));
    expect(s.yearly).toBe(false);
    expect(s.monthly).toBe(false);
  });

  it("one month after creation is the first monthly", () => {
    const s = hatchdayStatus(CREATED, local(2025, 9, 19));
    expect(s.monthly).toBe(true);
    expect(s.ageMonths).toBe(1);
  });

  it("unparseable createdAt yields no celebration", () => {
    const s = hatchdayStatus("not-a-date", local(2026, 8, 19));
    expect(s.yearly).toBe(false);
    expect(s.monthly).toBe(false);
  });
});

describe("REQ-110 yearly dedupe via memory rows", () => {
  const NOW = local(2026, 8, 19);

  it("detects a celebration recorded this year", () => {
    expect(
      hasCelebratedHatchdayThisYear(
        [{ type: HATCHDAY_MEMORY_TYPE, content: `${HATCHDAY_MEMORY_MARKER}! 1 year together 🎉`, createdAt: "2026-08-19T09:00:00Z" }],
        NOW,
      ),
    ).toBe(true);
  });

  it("last year's celebration does not block this year", () => {
    expect(
      hasCelebratedHatchdayThisYear(
        [{ type: HATCHDAY_MEMORY_TYPE, content: `${HATCHDAY_MEMORY_MARKER}! 1 year together 🎉`, createdAt: "2025-08-19T09:00:00Z" }],
        NOW,
      ),
    ).toBe(false);
  });

  it("unrelated memories do not count", () => {
    expect(
      hasCelebratedHatchdayThisYear(
        [{ type: HATCHDAY_MEMORY_TYPE, content: "likes strawberries", createdAt: "2026-08-01T00:00:00Z" }],
        NOW,
      ),
    ).toBe(false);
  });

  it("a mere mention of hatch-day in another memory type does not suppress", () => {
    expect(
      hasCelebratedHatchdayThisYear(
        [{ type: "user_fact", content: "user said happy hatch-day", createdAt: "2026-08-01T00:00:00Z" }],
        NOW,
      ),
    ).toBe(false);
  });
});

describe("REQ-110 celebration copy", () => {
  it("memory content carries the marker and pluralizes", () => {
    expect(hatchdayMemoryContent(1)).toContain(HATCHDAY_MEMORY_MARKER);
    expect(hatchdayMemoryContent(1)).toContain("1 year ");
    expect(hatchdayMemoryContent(2)).toContain("2 years");
  });

  it("bubble names the pet", () => {
    expect(hatchdayBubble("Mochi", 1)).toContain("Mochi");
  });
});
