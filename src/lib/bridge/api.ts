import { invoke, isTauri } from "./tauri";
import type { PetState } from "../sim/state";

export type { PetState };

export type Memory = {
  id: string;
  type: string;
  content: string;
  importance: number;
  confidence: number;
  sourceInteractionId?: string | null;
  createdAt: string;
  lastAccessedAt?: string | null;
  decayScore: number;
};

export type Settings = {
  petName: string;
  personalityPreset: string;
  llmProvider: string;
  ollamaEndpoint: string;
  ollamaModel: string;
  localOnlyMode: boolean;
  autonomousSpeech: boolean;
  memoryEnabled: boolean;
  animationIntensity: number;
  alwaysOnTop: boolean;
  startOnLogin: boolean;
  petHomePath?: string | null;
  developerEventLog: boolean;
  /** Read-only: true if a cloud API key is on disk. The key value is never returned. */
  cloudApiKeySet: boolean;
};

export type ChatReply = {
  text: string;
  usedLlm: boolean;
  model?: string | null;
  interactionId: string;
  /** Authoritative pet state after the chat-side mutations applied by the backend. */
  pet: PetState;
};

export type InboxFile = {
  name: string;
  sizeBytes: number;
  modified?: string | null;
};

export type EventLogEntry = {
  id: string;
  eventType: string;
  payloadJson?: string | null;
  salience?: number | null;
  handled: boolean;
  createdAt: string;
};

export type DailyReflection = {
  id: string;
  reflectionDate: string;
  learned?: string | null;
  noticed?: string | null;
  wants?: string | null;
  rawText?: string | null;
  createdAt: string;
};

export type SkillManifest = {
  id: string;
  name: string;
  description: string;
  requiresPermission: boolean;
  allowedInputs: string[];
  tools: string[];
  enabled: boolean;
};

export const api = {
  hasBackend: isTauri,

  getPetState: () => invoke<PetState>("get_pet_state"),
  savePetState: (pet: PetState) => invoke<PetState>("save_pet_state", { pet }),

  getSettings: () => invoke<Settings>("get_settings"),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  setCloudApiKey: (key: string | null) =>
    invoke<boolean>("set_cloud_api_key", { key }),

  listMemories: (limit = 100) => invoke<Memory[]>("list_memories", { limit }),
  searchMemories: (query: string, limit = 6) =>
    invoke<Memory[]>("search_memories", { query, limit }),
  createMemory: (memory: Partial<Memory> & { type: string; content: string }) =>
    invoke<Memory>("create_memory", { memory }),
  deleteMemory: (id: string) => invoke<void>("delete_memory", { id }),
  exportMemories: (format: "md" | "json") =>
    invoke<string>("export_memories", { format }),

  sendMessage: (message: string) => invoke<ChatReply>("send_message", { message }),
  autonomousSpeak: (kind: string, awayMinutes?: number) =>
    invoke<ChatReply>("autonomous_speak", { kind, awayMinutes }),

  listInboxFiles: () => invoke<InboxFile[]>("list_inbox_files"),
  approveFile: (fileName: string) => invoke<string>("approve_file", { fileName }),

  runDailyReflection: () => invoke<DailyReflection>("run_daily_reflection"),
  getLastReflection: () => invoke<DailyReflection | null>("get_last_reflection"),

  getEventLog: (limit = 100) => invoke<EventLogEntry[]>("get_event_log", { limit }),
  logEvent: (eventType: string, payload?: string, salience?: number) =>
    invoke<EventLogEntry>("log_event", { eventType, payload, salience }),

  listSkills: () => invoke<SkillManifest[]>("list_skills"),
};
