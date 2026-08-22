/**
 * REQ-122 — thin OS-notification wrapper around tauri-plugin-notification.
 * Never throws: every failure is non-fatal and logged with console.warn only.
 * Silent per PRD §27.2.2 — no sound, badge, or sfx is ever requested.
 */
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import { api } from "./api";

/** Fire a desktop notification. Returns false when it was not delivered. */
export async function notifyDesktop(title: string, body: string): Promise<boolean> {
  if (!api.hasBackend) return false;
  try {
    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (!granted) return false;
    sendNotification({ title, body });
    return true;
  } catch (err) {
    console.warn("desktop notification failed", err);
    return false;
  }
}
