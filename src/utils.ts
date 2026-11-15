import type { InsertionResult, VoicePhase, VoiceState } from "./types";

export function formatDuration(durationMs: number): string {
  const wholeSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function clampLevel(level: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0));
}

export function isRecordingActive(phase: VoicePhase): boolean {
  return phase === "starting" || phase === "recording";
}

export function isProcessing(phase: VoicePhase): boolean {
  return phase === "transcribing" || phase === "cleaning";
}

export function isBusy(phase: VoicePhase): boolean {
  return isRecordingActive(phase) || isProcessing(phase);
}

export function phaseLabel(phase: VoicePhase): string {
  const labels: Record<VoicePhase, string> = {
    idle: "Ready when you are",
    starting: "Opening microphone",
    recording: "Listening",
    transcribing: "Transcribing securely",
    cleaning: "Polishing your words",
    done: "Preview ready",
    error: "Needs attention",
    cancelled: "Practice cancelled",
  };
  return labels[phase];
}

export function insertionLabel(insertion: InsertionResult, targetApp: string): string | null {
  switch (insertion) {
    case "preview":
      return "Practice result kept here for your review.";
    case "pasted":
      return targetApp ? `Inserted into ${targetApp}.` : "Inserted into the active app.";
    case "copy_required":
      return "Ready to copy — the target app did not accept insertion.";
    default:
      return null;
  }
}

export function voiceMessage(state: VoiceState): string {
  if (state.message.trim()) return state.message;
  return phaseLabel(state.phase);
}

export function readableDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}
