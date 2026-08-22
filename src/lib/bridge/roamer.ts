/**
 * REQ-120 — thin monitor bridge for the roam path. All coordinates returned
 * here are LOGICAL pixels (physical / scaleFactor) so src/lib/sim stays in a
 * single unit system; conversion happens once at this boundary. The window
 * position itself is physical and is converted by the caller, which owns the
 * authoritative physical cache.
 */
import { availableMonitors, currentMonitor } from "@tauri-apps/api/window";
import { api } from "./api";
import type { MonitorInfo } from "../sim/roam";

export type WorkArea = {
  /** Monitor name — the id planMonitorCrossing matches against. Null when the
   *  OS reports no name (crossing is skipped; edge walking still works). */
  id: string | null;
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
      id: m.name,
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

/**
 * REQ-121 — all monitors as logical-px descriptors (each rect divided by that
 * monitor's own scaleFactor). Monitors without a name are dropped — they
 * cannot be addressed as crossing targets. Null (never throws) on failure.
 */
export async function listMonitors(): Promise<MonitorInfo[] | null> {
  if (!api.hasBackend) return null;
  try {
    const list = await availableMonitors();
    return list
      .filter((m): m is typeof m & { name: string } => typeof m.name === "string")
      .map((m) => ({
        id: m.name,
        x: m.position.x / m.scaleFactor,
        y: m.position.y / m.scaleFactor,
        width: m.size.width / m.scaleFactor,
        height: m.size.height / m.scaleFactor,
        scaleFactor: m.scaleFactor,
      }));
  } catch (err) {
    console.warn("availableMonitors failed", err);
    return null;
  }
}
