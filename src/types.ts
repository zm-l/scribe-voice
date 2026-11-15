export type ActivationMode = "toggle" | "hold";
// Saved values are "auto" or validated ISO-639-1 codes from the shared catalog.
export type Language = string;
export type TranscriptionModel =
  | "openai/gpt-4o-mini-transcribe"
  | "openai/gpt-4o-transcribe"
  | "google/gemini-2.5-flash";
export type CleanupModel = "openai/gpt-4.1-mini";

export interface Settings {
  shortcut: string;
  activation_mode: ActivationMode;
  cleanup_enabled: boolean;
  save_history: boolean;
  language: Language;
  transcription_model: TranscriptionModel;
  cleanup_model: CleanupModel;
  onboarding_complete: boolean;
}

export type VoicePhase =
  | "idle"
  | "starting"
  | "recording"
  | "transcribing"
  | "cleaning"
  | "done"
  | "error"
  | "cancelled";

export type InsertionResult = "none" | "preview" | "pasted" | "copy_required";

export interface VoiceState {
  phase: VoicePhase;
  session_id: number;
  level: number;
  duration_ms: number;
  raw_text: string;
  text: string;
  message: string;
  insertion: InsertionResult;
  target_app: string;
  /** Saved spoken-language hint captured when this recording started. */
  language_hint: string;
  /** Saved transcription model captured when this recording started. */
  transcription_model: string;
}

export interface Bootstrap {
  settings: Settings;
  state: VoiceState;
  has_api_key: boolean;
  platform: "windows";
  version: string;
}

export interface HistoryEntry {
  id: number;
  created_at: string;
  raw_text: string;
  text: string;
  model: string;
  insertion: string;
}

export interface VoiceLevelEvent {
  level: number;
  duration_ms: number;
}

export interface MicrophoneProbe {
  device_name: string;
  peak_level: number;
  detected_audio: boolean;
}

export const defaultSettings: Settings = {
  shortcut: "Ctrl+Shift+Space",
  activation_mode: "toggle",
  cleanup_enabled: true,
  save_history: false,
  language: "auto",
  transcription_model: "openai/gpt-4o-mini-transcribe",
  cleanup_model: "openai/gpt-4.1-mini",
  onboarding_complete: false,
};

export const defaultVoiceState: VoiceState = {
  phase: "idle",
  session_id: 0,
  level: 0,
  duration_ms: 0,
  raw_text: "",
  text: "",
  message: "",
  insertion: "none",
  target_app: "",
  language_hint: "auto",
  transcription_model: "",
};
