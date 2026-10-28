/**
 * In-memory fake of the Tauri backend for the e2e harness page. Installs
 * `mockWindows` / `mockIPC` from `@tauri-apps/api/mocks`, then the app's real
 * `src/main.ts` boots against it. Test-only — never part of the app bundle.
 *
 * Behaviour mirrors the Rust commands where specs depend on it:
 * `save_settings` rejects a non-loopback Ollama endpoint in local-only mode
 * (commands/state.rs) and normalizes skin/accessory/personality/scale/name;
 * `save_pet_state` rejects fractional stats like serde does for i32.
 */
import { mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import type { HarnessConfig, PetState, QaApi, Settings } from "./types";

const SKINS = ["classic", "peach", "matcha", "sky", "lavender", "cocoa"];
const ACCESSORIES = ["none", "bow", "flower", "crown", "tophat", "cap"];
const PERSONALITIES = ["curious", "lazy", "playful", "quiet"];
const STAGES = ["transparent", "auto", "cream", "blossom", "mint", "night"];
const LLM_COMMANDS = new Set(["send_message", "autonomous_speak", "choose_choreography"]);

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));
const nowIso = () => new Date().toISOString();

/** Mirrors `endpoint_is_loopback` in src-tauri/src/models.rs. */
function isLoopback(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    return host === "localhost" || host === "[::1]" || /^127\.\d+\.\d+\.\d+$/.test(host);
  } catch {
    return false;
  }
}

export function installFakeBackend(config: HarnessConfig, isSettingsWindow: boolean): QaApi {
  const created = new Date(Date.now() - 3 * 86_400_000).toISOString();
  const pet: PetState = {
    id: "default",
    name: "Mochi",
    mood: "happy",
    hunger: 30,
    energy: 80,
    affection: 50,
    boredom: 20,
    curiosity: 40,
    stress: 10,
    trust: 50,
    relationshipLevel: 1,
    currentAnimation: "idle",
    currentIntent: "idle",
    lastInteractionAt: nowIso(),
    lastLlmCallAt: null,
    lastReportAt: nowIso(),
    createdAt: created,
    updatedAt: nowIso(),
    ...config.pet,
  };
  const settings: Settings = {
    petName: pet.name,
    personalityPreset: "curious",
    petScale: 1,
    petSkin: "classic",
    petAccessory: "none",
    llmProvider: "ollama",
    ollamaEndpoint: "http://localhost:11434",
    ollamaModel: "gemma4:e2b",
    localOnlyMode: true,
    autonomousSpeech: true,
    memoryEnabled: true,
    animationIntensity: 1,
    alwaysOnTop: true,
    startOnLogin: false,
    petHomePath: "/Users/qa/Library/Application Support/com.petmochi.app/pet_home",
    developerEventLog: false,
    stageBackground: "transparent",
    soundEffects: false,
    desktopNotifications: false,
    cloudApiKeySet: false,
    ...config.settings,
  };

  const qa: QaApi = {
    config,
    ready: false,
    pet,
    settings,
    calls: [],
    petSaves: [],
    settingsSaves: [],
    emits: [],
    llmCalls: [],
    windowCalls: [],
    unknown: {},
    anims: [],
    mouse: { x: -1000, y: -1000 },
    winPos: { x: 800, y: 400 },
    fire: (event, payload) => {
      const handlers = listeners[event] ?? [];
      for (const id of handlers) {
        window.__TAURI_INTERNALS__.runCallback(id, { event, id, payload });
      }
      return handlers.length;
    },
  };
  window.__qa = qa;
  const listeners: Record<string, number[]> = {};

  const trackMouse = (e: MouseEvent) => (qa.mouse = { x: e.clientX, y: e.clientY });
  document.addEventListener("mousemove", trackMouse, true);
  document.addEventListener("pointermove", trackMouse, true);

  // Record every pose change of the sprite so specs can assert sequences.
  new MutationObserver(() => {
    const anim = document.querySelector<HTMLElement>(".mochi")?.dataset.anim;
    const last = qa.anims[qa.anims.length - 1];
    if (anim && anim !== last?.anim) qa.anims.push({ t: Date.now(), anim });
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-anim"],
  });

  const memories = [
    { id: "m1", type: "user_preference", content: "Likes green tea in the morning", importance: 0.6, confidence: 0.8, createdAt: created, decayScore: 1 },
    { id: "m2", type: "keepsake", content: "A pressed clover leaf", importance: 0.5, confidence: 1, createdAt: created, decayScore: 1 },
  ];
  const events = [
    { id: "e1", eventType: "APP_STARTED", payloadJson: null, salience: 10, handled: true, createdAt: created },
    { id: "e2", eventType: "USER_FED_PET", payloadJson: '{"snack":"dango"}', salience: 35, handled: true, createdAt: created },
  ];
  const reports = [
    { id: "r1", windowStart: created, windowEnd: created, learned: "You like tea", noticed: "Quiet day", wants: "More play", prose: "A calm day.", filePath: "/tmp/r1.md", createdAt: created },
  ];
  const monitor = {
    name: "QA-Display",
    scaleFactor: 1,
    position: { x: 0, y: 0 },
    size: { width: 1920, height: 1080 },
    workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
  };

  async function saveSettings(input: Settings): Promise<Settings> {
    const entry: { t: number; settings: Settings; rejected?: string } = { t: Date.now(), settings: clone(input) };
    qa.settingsSaves.push(entry);
    const delay = qa.config.saveSettingsDelays?.shift() ?? 0;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    const fail = (msg: string) => {
      entry.rejected = msg;
      throw msg;
    };
    if (input.localOnlyMode && input.llmProvider === "ollama" && !isLoopback(input.ollamaEndpoint)) {
      fail("invalid input: local-only mode requires a loopback Ollama endpoint (localhost / 127.0.0.1 / ::1)");
    }
    if (qa.config.autostartError && input.startOnLogin !== qa.settings.startOnLogin) {
      fail(`start on login error: ${qa.config.autostartError}`);
    }
    const s = clone(input);
    s.petSkin = SKINS.includes(s.petSkin) ? s.petSkin : "classic";
    s.petAccessory = ACCESSORIES.includes(s.petAccessory) ? s.petAccessory : "none";
    s.personalityPreset = PERSONALITIES.includes(s.personalityPreset) ? s.personalityPreset : "curious";
    s.stageBackground = STAGES.includes(s.stageBackground) ? s.stageBackground : "transparent";
    s.petScale = Math.min(1.5, Math.max(0.75, Number(s.petScale) || 1));
    s.petName = s.petName.trim().slice(0, 24) || "Mochi";
    s.petHomePath = qa.settings.petHomePath;
    s.cloudApiKeySet = qa.settings.cloudApiKeySet;
    qa.settings = s;
    qa.pet = { ...qa.pet, name: s.petName };
    return clone(s);
  }

  function handle(cmd: string, args: Record<string, any> = {}): unknown {
    // The hit-test loop polls these every 80 ms; keep them out of the log.
    if (!cmd.startsWith("plugin:window|cursor") && cmd !== "plugin:window|outer_position") {
      qa.calls.push({ t: Date.now(), cmd, args });
    }
    const rejection = qa.config.reject?.[cmd];
    if (rejection !== undefined) return Promise.reject(rejection);
    if (LLM_COMMANDS.has(cmd)) qa.llmCalls.push({ t: Date.now(), cmd, args });

    switch (cmd) {
      // ---- app commands ----
      case "get_pet_state":
        return clone(qa.pet);
      case "save_pet_state": {
        const next = args.pet as PetState;
        const fractional = Object.entries(next).filter(
          ([, v]) => typeof v === "number" && !Number.isInteger(v),
        );
        if (fractional.length) {
          throw `invalid type: floating point for ${fractional.map(([k]) => k).join(",")}`;
        }
        qa.petSaves.push({ t: Date.now(), pet: clone(next) });
        qa.pet = { ...next, id: "default", updatedAt: nowIso() };
        return clone(qa.pet);
      }
      case "quit_app":
      case "open_settings":
        return null;
      case "get_settings":
        return clone(qa.settings);
      case "save_settings":
        return saveSettings(args.settings as Settings);
      case "set_cloud_api_key":
        qa.settings.cloudApiKeySet = !!args.key;
        return !!args.key;
      case "list_memories":
        return clone(memories);
      case "search_memories":
        return [];
      case "create_memory": {
        const m = { id: `m${memories.length + 1}`, importance: 0.5, confidence: 1, decayScore: 1, createdAt: nowIso(), ...args.memory };
        memories.push(m);
        return clone(m);
      }
      case "delete_memory": {
        const i = memories.findIndex((m) => m.id === args.id);
        if (i >= 0) memories.splice(i, 1);
        return null;
      }
      case "export_memories":
        return `/tmp/mochi-export.${args.format}`;
      case "send_message":
      case "autonomous_speak":
        return { text: "(mock reply)", usedLlm: true, model: "mock", interactionId: "i1", pet: clone(qa.pet) };
      case "choose_choreography":
        return Promise.reject("llm provider unavailable: mock");
      case "list_inbox_files":
        return clone(qa.config.inbox ?? []);
      case "approve_file":
        return "A short file about notes.";
      case "run_daily_reflection":
      case "get_last_reflection":
        return null;
      case "run_status_report":
        return { ...reports[0], id: `r${reports.length + 1}`, windowEnd: nowIso(), createdAt: nowIso() };
      case "list_status_reports":
        return clone(reports);
      case "generate_interaction_report":
        return { text: "We had a nice time.", savedPath: "/tmp/r.md", usedLlm: false, eventCount: 3 };
      case "get_event_log":
        return clone(events);
      case "log_event": {
        const e = { id: `e${events.length + 1}`, eventType: args.eventType, payloadJson: args.payload ?? null, salience: args.salience ?? null, handled: false, createdAt: nowIso() };
        events.unshift(e);
        return clone(e);
      }
      case "list_skills":
        return [];
      // ---- event plugin ----
      case "plugin:event|listen":
        (listeners[args.event] ??= []).push(args.handler);
        return args.handler;
      case "plugin:event|unlisten":
        return null;
      case "plugin:event|emit":
      case "plugin:event|emit_to":
        qa.emits.push({ t: Date.now(), event: args.event, payload: clone(args.payload ?? null) });
        return null;
      // ---- window plugin ----
      case "plugin:window|get_all_windows":
        return ["main", "settings"];
      case "plugin:window|scale_factor":
        return 1;
      case "plugin:window|outer_position":
      case "plugin:window|inner_position":
        return { ...qa.winPos };
      case "plugin:window|inner_size":
      case "plugin:window|outer_size":
        return { width: innerWidth, height: innerHeight };
      case "plugin:window|cursor_position":
        return { x: qa.winPos.x + qa.mouse.x, y: qa.winPos.y + qa.mouse.y };
      case "plugin:window|current_monitor":
      case "plugin:window|primary_monitor":
        return clone(monitor);
      case "plugin:window|available_monitors":
        return [clone(monitor)];
      // Size/Position arrive as class instances; their JSON form is the IPC
      // wire format ({ Logical: {...} } / { Physical: {...} }).
      case "plugin:window|set_position": {
        qa.windowCalls.push({ t: Date.now(), cmd, args: clone(args) });
        const v = clone(args).value;
        const p = v?.Physical ?? v?.Logical ?? v;
        if (p && typeof p.x === "number") qa.winPos = { x: p.x, y: p.y };
        return null;
      }
      case "plugin:window|set_size": {
        qa.windowCalls.push({ t: Date.now(), cmd, args: clone(args) });
        const v = clone(args).value;
        const size = v?.Logical ?? v?.Physical ?? v;
        if (window.qaResize && size) {
          return window.qaResize(Math.round(size.width), Math.round(size.height)).then(() => null);
        }
        return null;
      }
      case "plugin:window|set_ignore_cursor_events":
      case "plugin:window|set_always_on_top":
      case "plugin:window|start_dragging":
        qa.windowCalls.push({ t: Date.now(), cmd, args: clone(args) });
        return null;
      case "plugin:notification|is_permission_granted":
        return false;
      case "plugin:notification|request_permission":
        return "denied";
      default:
        qa.unknown[cmd] = (qa.unknown[cmd] ?? 0) + 1;
        return null;
    }
  }

  const current = isSettingsWindow ? "settings" : "main";
  mockWindows(current, isSettingsWindow ? "main" : "settings");
  mockIPC((cmd, args) => handle(cmd, args as Record<string, any>));
  return qa;
}
