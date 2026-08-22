import { describe, expect, it } from "vitest";
import { resolveStageTheme } from "./ambient";

describe("REQ-118 resolveStageTheme — period → stage theme", () => {
  it("morning resolves to blossom", () => {
    expect(resolveStageTheme("morning")).toBe("blossom");
  });

  it("afternoon resolves to mint", () => {
    expect(resolveStageTheme("afternoon")).toBe("mint");
  });

  it("evening resolves to cream", () => {
    expect(resolveStageTheme("evening")).toBe("cream");
  });

  it("night resolves to night", () => {
    expect(resolveStageTheme("night")).toBe("night");
  });
});
