import { describe, expect, it } from "vitest";
import {
  applySnackFeed,
  FAVORITE_MEMORY_MARKER,
  FAVORITE_MEMORY_TYPE,
  favoriteSnackFor,
  isFavoriteDiscoveredInMemories,
  SNACK_KEYS,
  SNACKS,
} from "./snacks";
import { applyAction } from "./actions";
import { newPetState, type PetState } from "./state";

function pet(overrides: Partial<PetState> = {}): PetState {
  return { ...newPetState(), ...overrides };
}

/** The default pet's favorite, resolved once so tests stay explicit. */
function favoriteOf(p: PetState) {
  return favoriteSnackFor(p.id, p.createdAt);
}

function nonFavoriteOf(p: PetState) {
  const fav = favoriteOf(p);
  return SNACK_KEYS.find((k) => k !== fav)!;
}

describe("REQ-107 favorite derivation", () => {
  it("is stable for the same pet identity", () => {
    const p = pet();
    expect(favoriteSnackFor(p.id, p.createdAt)).toBe(
      favoriteSnackFor(p.id, p.createdAt),
    );
  });

  it("is one of the three snack keys", () => {
    expect(SNACK_KEYS).toContain(favoriteSnackFor("default", "2026-01-01T00:00:00Z"));
  });

  it("varies across identities (not a constant function)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      seen.add(favoriteSnackFor(`pet-${i}`, "2026-01-01T00:00:00Z"));
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("REQ-107 snack feeding — stat parity with the Feed action", () => {
  it("non-favorite snack matches applyAction('feed') stat deltas", () => {
    const p = pet({ hunger: 80, affection: 40, stress: 30, curiosity: 80 });
    const viaAction = applyAction(p, "feed", () => 0).state;
    const viaSnack = applySnackFeed(p, nonFavoriteOf(p), false).state;
    expect(viaSnack.hunger).toBe(viaAction.hunger);
    expect(viaSnack.affection).toBe(viaAction.affection);
    expect(viaSnack.stress).toBe(viaAction.stress);
    expect(viaSnack.curiosity).toBe(viaAction.curiosity);
  });

  it("favorite snack grants +2 extra affection", () => {
    const p = pet({ affection: 40 });
    const plain = applySnackFeed(p, nonFavoriteOf(p), false);
    const fav = applySnackFeed(p, favoriteOf(p), true);
    expect(fav.state.affection).toBe(plain.state.affection + 2);
  });

  it("uses the same audit event type and salience as Feed", () => {
    const p = pet();
    const r = applySnackFeed(p, nonFavoriteOf(p), false);
    expect(r.eventType).toBe("USER_FED_PET");
    expect(r.salience).toBe(35);
  });

  it("recomputes mood on the same tap (hungry clears)", () => {
    const p = pet({ hunger: 90, mood: "hungry" });
    const r = applySnackFeed(p, nonFavoriteOf(p), false);
    expect(r.state.mood).not.toBe("hungry");
  });

  it("stamps lastInteractionAt", () => {
    const r = applySnackFeed(pet({ lastInteractionAt: null }), "dango", false);
    expect(r.state.lastInteractionAt).not.toBeNull();
  });
});

describe("REQ-107 favorite discovery", () => {
  it("first favorite feed sets favoriteDiscovered and returns a memory payload", () => {
    const p = pet();
    const r = applySnackFeed(p, favoriteOf(p), false);
    expect(r.isFavorite).toBe(true);
    expect(r.favoriteDiscovered).toBe(true);
    expect(r.memory).not.toBeNull();
    expect(r.memory!.type).toBe(FAVORITE_MEMORY_TYPE);
    expect(r.memory!.content).toContain(FAVORITE_MEMORY_MARKER);
    expect(r.memory!.content).toContain(SNACKS[favoriteOf(p)].icon);
  });

  it("repeat favorite feeds are favorite but not a discovery", () => {
    const p = pet();
    const r = applySnackFeed(p, favoriteOf(p), true);
    expect(r.isFavorite).toBe(true);
    expect(r.favoriteDiscovered).toBe(false);
    expect(r.memory).toBeNull();
  });

  it("non-favorite feeds never discover", () => {
    const p = pet();
    const r = applySnackFeed(p, nonFavoriteOf(p), false);
    expect(r.isFavorite).toBe(false);
    expect(r.favoriteDiscovered).toBe(false);
    expect(r.memory).toBeNull();
  });

  it("favorite sequence includes a blush beat; plain sequence does not", () => {
    const p = pet();
    const fav = applySnackFeed(p, favoriteOf(p), true);
    const plain = applySnackFeed(p, nonFavoriteOf(p), false);
    expect(fav.steps.map((s) => s.animation)).toContain("blush");
    expect(plain.steps.map((s) => s.animation)).not.toContain("blush");
    // Both settle on celebrate so the resting pose reads as satisfied.
    expect(fav.steps[fav.steps.length - 1].animation).toBe("celebrate");
    expect(plain.steps[plain.steps.length - 1].animation).toBe("celebrate");
  });
});

describe("REQ-107 discovery restore from persisted memories", () => {
  it("detects a prior discovery memory", () => {
    expect(
      isFavoriteDiscoveredInMemories([
        { type: FAVORITE_MEMORY_TYPE, content: `Mochi's ${FAVORITE_MEMORY_MARKER} is 🍓 Strawberry` },
      ]),
    ).toBe(true);
  });

  it("ignores unrelated memories and wrong types", () => {
    expect(
      isFavoriteDiscoveredInMemories([
        { type: "preference", content: `user's ${FAVORITE_MEMORY_MARKER} is pizza` },
        { type: FAVORITE_MEMORY_TYPE, content: "likes sunny mornings" },
      ]),
    ).toBe(false);
    expect(isFavoriteDiscoveredInMemories([])).toBe(false);
  });
});
