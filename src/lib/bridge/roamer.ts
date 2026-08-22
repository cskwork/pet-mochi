/**
 * REQ-120 — thin monitor bridge for the roam path. All coordinates returned
 * here are LOGICAL pixels (physical / scaleFactor) so src/lib/sim stays in a
 * single unit system; conversion happens once at this boundary. The window
 * position itself is physical and is converted by the caller, which owns the
 * authoritative physical cache.
 */
import { currentMonitor } from "@tauri-apps/api/window";
import { api } from "./api";

export type WorkArea = {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleFactor: number;
};

/**
 * The current monitor's full bounds as the work area, in logical px. Returns
 * null (never throws) outside Tauri or when the monitor query fails — callers
 * abort silently and keep the classic in-window wander.
 */
export async function getWorkArea(): Promise<WorkArea | null> {
  if (!api.hasBackend) return null;
  try {
    const m = await currentMonitor();
    if (!m) return null;
    const s = m.scaleFactor;
    return {
      x: m.position.x / s,
      y: m.position.y / s,
      width: m.size.width / s,
      height: m.size.height / s,
      scaleFactor: s,
    };
  } catch (err) {
    console.warn("currentMonitor failed", err);
    return null;
  }
}
