import "./styles.css";
import App from "./App.svelte";
import { mount } from "svelte";

const target = document.getElementById("app");
if (!target) throw new Error("missing #app root");

// Tauri provides a transparent OS-level overlay window, so the body must stay
// transparent there. In a plain browser preview the cream-white sprite would
// vanish into the white page — paint a soft preview background instead.
const isTauri =
  typeof window !== "undefined" &&
  Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
if (!isTauri) {
  document.body.classList.add("browser-preview");
}

const app = mount(App, { target });

export default app;
