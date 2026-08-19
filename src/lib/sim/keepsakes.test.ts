import { describe, expect, it } from "vitest";
import {
  canLeaveKeepsake,
  KEEPSAKE_MEMORY_TYPE,
  KEEPSAKE_MIN_AFFECTION,
  KEEPSAKE_MIN_TRUST,
  KEEPSAKE_SPACING_MS,
  keepsakeBubble,
  keepsakeMemoryContent,
  lastKeepsakeAt,
  pickTrinket,
  TRINKETS,
} from "./keepsakes";
import { newPetState, type PetState } from "./state";

const NOW = Date.parse("2026-08-19T12:00:00Z");

function caredForPet(overrides: Partial<PetState> = {}): PetState {
  return {
    ...newPetState(),
    affection: KEEPSAKE_MIN_AFFECTION,
    trust: KEEPSAKE_MIN_TRUST,
    ...overrides,
  };
}

describe("REQ-109 keepsake gate", () => {
  it("opens with good care and no prior keepsake", () => {
    expect(canLeaveKeepsake(caredForPet(), null, NOW)).toBe(true);
  });

  it("requires affection ≥ 70", () => {
    expect(
      canLeaveKeepsake(caredForPet({ affection: KEEPSAKE_MIN_AFFECTION - 1 }), null, NOW),
    ).toBe(false);
  });

  it("requires trust ≥ 55", () => {
    expect(
      canLeaveKeepsake(caredForPet({ trust: KEEPSAKE_MIN_TRUST - 1 }), null, NOW),
    ).toBe(false);
  });

  it("enforces the 20h spacing, then reopens", () => {
    const tooRecent = new Date(NOW - KEEPSAKE_SPACING_MS + 1).toISOString();
    expect(canLeaveKeepsake(caredForPet(), tooRecent, NOW)).toBe(false);
    const oldEnough = new Date(NOW - KEEPSAKE_SPACING_MS).toISOString();
    expect(canLeaveKeepsake(caredForPet(), oldEnough, NOW)).toBe(true);
  });

  it("refuses on an unparseable timestamp instead of spamming", () => {
    expect(canLeaveKeepsake(caredForPet(), "not-a-date", NOW)).toBe(false);
  });
});

describe("REQ-109 trinket pick", () => {
  it("is deterministic for (pet, day) — a restart cannot re-roll the gift", () => {
    const a = pickTrinket("default", "2026-08-19T09:00:00Z");
    const b = pickTrinket("default", "2026-08-19T23:59:00Z");
    expect(a).toEqual(b);
  });

  it("varies across days", () => {
    const seen = new Set<string>();
    for (let d = 1; d <= 28; d++) {
      const day = String(d).padStart(2, "0");
      seen.add(pickTrinket("default", `2026-08-${day}T12:00:00Z`).name);
    }
    expect(seen.size).toBeGreaterThan(3);
  });

  it("always picks from the 12-item table", () => {
    expect(TRINKETS.length).toBe(12);
    expect(TRINKETS).toContainEqual(pickTrinket("default", "2026-08-19"));
  });
});

describe("REQ-109 memory payload and restore", () => {
  it("memory content renders icon + name + dedication", () => {
    const t = TRINKETS[0];
    const content = keepsakeMemoryContent(t);
    expect(content).toContain(t.icon);
    expect(content).toContain(t.name);
    expect(content).toContain("for you");
  });

  it("bubble names the pet and shows the trinket", () => {
    const t = TRINKETS[1];
    const b = keepsakeBubble("Mochi", t);
    expect(b).toContain("Mochi");
    expect(b).toContain(t.icon);
  });

  it("lastKeepsakeAt returns the newest keepsake timestamp", () => {
    expect(
      lastKeepsakeAt([
        { type: KEEPSAKE_MEMORY_TYPE, createdAt: "2026-08-01T00:00:00Z" },
        { type: "preference", createdAt: "2026-08-19T00:00:00Z" },
        { type: KEEPSAKE_MEMORY_TYPE, createdAt: "2026-08-10T00:00:00Z" },
      ]),
    ).toBe("2026-08-10T00:00:00Z");
  });

  it("lastKeepsakeAt is null when no keepsakes exist", () => {
    expect(lastKeepsakeAt([{ type: "preference", createdAt: "2026-08-19" }])).toBeNull();
    expect(lastKeepsakeAt([])).toBeNull();
  });
});
