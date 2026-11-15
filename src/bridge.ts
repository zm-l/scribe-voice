import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Bootstrap,
  HistoryEntry,
  MicrophoneProbe,
  Settings,
  VoiceLevelEvent,
  VoiceState,
} from "./types";

/** True only when this page is hosted by the Tauri desktop runtime. */
export function isDesktopRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function assertDesktopRuntime(): void {
  if (!isDesktopRuntime()) {
    throw new Error("Scribe Voice desktop APIs are unavailable in this browser preview.");
  }
}

export const getBootstrap = async (): Promise<Bootstrap> => {
  assertDesktopRuntime();
  return invoke<Bootstrap>("get_bootstrap");
};

export const saveSettings = async (settings: Settings): Promise<Settings> => {
  assertDesktopRuntime();
  return invoke<Settings>("save_settings", { settings });
};

export const setApiKey = async (key: string): Promise<boolean> => {
  assertDesktopRuntime();
  return invoke<boolean>("set_api_key", { key });
};

export const deleteApiKey = async (): Promise<void> => {
  assertDesktopRuntime();
  return invoke<void>("delete_api_key");
};

export const probeMicrophone = async (): Promise<MicrophoneProbe> => {
  assertDesktopRuntime();
  return invoke<MicrophoneProbe>("probe_microphone");
};

export const openMicrophoneSettings = async (): Promise<void> => {
  assertDesktopRuntime();
  return invoke<void>("open_microphone_settings");
};

export const startRecording = async (): Promise<void> => {
  assertDesktopRuntime();
  return invoke<void>("start_recording");
};

export const stopRecording = async (): Promise<void> => {
  assertDesktopRuntime();
  return invoke<void>("stop_recording");
};

export const cancelRecording = async (): Promise<void> => {
  assertDesktopRuntime();
  return invoke<void>("cancel_recording");
};

export const copyText = async (text: string): Promise<void> => {
  assertDesktopRuntime();
  return invoke<void>("copy_text", { text });
};

export const listHistory = async (): Promise<HistoryEntry[]> => {
  assertDesktopRuntime();
  return invoke<HistoryEntry[]>("list_history");
};

export const clearHistory = async (): Promise<void> => {
  assertDesktopRuntime();
  return invoke<void>("clear_history");
};

export const hideWindow = async (): Promise<void> => {
  assertDesktopRuntime();
  return invoke<void>("hide_window");
};

export async function listenVoiceEvents(handlers: {
  onState: (state: VoiceState) => void;
  onLevel: (level: VoiceLevelEvent) => void;
}): Promise<() => void> {
  assertDesktopRuntime();

  let unlistenState: UnlistenFn | undefined;
  let unlistenLevel: UnlistenFn | undefined;

  try {
    unlistenState = await listen<VoiceState>("voice-state", (event) => {
      handlers.onState(event.payload);
    });
    unlistenLevel = await listen<VoiceLevelEvent>("voice-level", (event) => {
      handlers.onLevel(event.payload);
    });
  } catch (error) {
    unlistenState?.();
    throw error;
  }

  return () => {
    unlistenState?.();
    unlistenLevel?.();
  };
}
