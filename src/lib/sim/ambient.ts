import type { RuntimeContext } from "./state";

/** Themed stage backgrounds the "auto" value can resolve to (REQ-114 set). */
export type StageTheme = "blossom" | "mint" | "cream" | "night";

/**
 * REQ-118 — resolve the stage theme for the "auto" stage background from the
 * current time-of-day period. Pure and deterministic: the mapping is fixed so
 * the theme swap at each TIME_OF_DAY_CHANGED transition never surprises.
 */
export function resolveStageTheme(period: RuntimeContext["timeOfDay"]): StageTheme {
  switch (period) {
    case "morning":
      return "blossom";
    case "afternoon":
      return "mint";
    case "evening":
      return "cream";
    case "night":
      return "night";
  }
}
