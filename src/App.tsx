import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  AudioLines,
  Check,
  ChevronRight,
  CircleHelp,
  Clipboard,
  Cloud,
  Copy,
  Gauge,
  History,
  KeyRound,
  Keyboard,
  LoaderCircle,
  LockKeyhole,
  Mic,
  MonitorDown,
  PanelLeft,
  Play,
  Save,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Volume2,
  Waves,
  X,
} from "lucide-react";
import {
  cancelRecording,
  clearHistory,
  copyText,
  deleteApiKey,
  getBootstrap,
  hideWindow,
  isDesktopRuntime,
  listenVoiceEvents,
  listHistory,
  openMicrophoneSettings,
  probeMicrophone,
  saveSettings,
  setApiKey,
  startRecording,
  stopRecording,
} from "./bridge";
import {
  defaultSettings,
  defaultVoiceState,
  type Bootstrap,
  type HistoryEntry,
  type MicrophoneProbe,
  type Settings,
  type VoiceState,
} from "./types";
import {
  clampLevel,
  formatDuration,
  insertionLabel,
  isBusy,
  isProcessing,
  isRecordingActive,
  phaseLabel,
  readableDate,
  voiceMessage,
} from "./utils";

import { RecognitionLanguageField } from "./RecognitionLanguageField";
import { normalizeRecognitionLanguage, recognitionLanguageLabel } from "./languages";

type Page = "overview" | "history" | "settings";
type TranscriptView = "cleaned" | "raw";
type PendingAction =
  | "start"
  | "stop"
  | "cancel"
  | "copy"
  | "save-settings"
  | "save-key"
  | "delete-key"
  | "probe-mic"
  | "open-mic-settings"
  | "clear-history"
  | "hide-window"
  | null;

interface NativeConnection {
  settings: Settings;
  voice: VoiceState;
  hasApiKey: boolean;
  version: string;
  loading: boolean;
  error: string | null;
  applySettings: (settings: Settings) => void;
  applyApiKeyAvailability: (hasApiKey: boolean) => void;
}

const noop = () => undefined;

const browserConnection: NativeConnection = {
  settings: defaultSettings,
  voice: defaultVoiceState,
  hasApiKey: false,
  version: "0.1.4",
  loading: false,
  error: null,
  applySettings: noop,
  applyApiKeyAvailability: noop,
};

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "An unexpected desktop error occurred. Please try again.";
}

function useNativeConnection(): NativeConnection {
  const desktop = isDesktopRuntime();
  const [connection, setConnection] = useState<NativeConnection>(() =>
    desktop ? { ...browserConnection, loading: true } : browserConnection,
  );

  useEffect(() => {
    if (!desktop) {
      setConnection(browserConnection);
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;
    let receivedVoiceState = false;

    const bootstrap = async () => {
      try {
        // Event subscriptions intentionally complete before the snapshot request so a
        // native recording that lives past a window hide cannot be missed.
        unlisten = await listenVoiceEvents({
          onState: (voice) => {
            if (!disposed) {
              receivedVoiceState = true;
              setConnection((current) => ({ ...current, voice, error: null }));
            }
          },
          onLevel: ({ level, duration_ms }) => {
            if (!disposed) {
              setConnection((current) => ({
                ...current,
                voice: {
                  ...current.voice,
                  level: clampLevel(level),
                  duration_ms,
                },
              }));
            }
          },
        });

        if (disposed) {
          unlisten();
          return;
        }

        const result: Bootstrap = await getBootstrap();
        if (!disposed) {
          setConnection((current) => ({
            ...current,
            settings: result.settings,
            voice: receivedVoiceState
              ? current.voice
              : { ...result.state, level: clampLevel(result.state.level) },
            hasApiKey: result.has_api_key,
            version: result.version,
            loading: false,
            error: null,
          }));
        }
      } catch (error) {
        if (!disposed) {
          setConnection((current) => ({
            ...current,
            loading: false,
            error: errorMessage(error),
          }));
        }
      }
    };

    void bootstrap();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [desktop]);

  const applySettings = useCallback((settings: Settings) => {
    setConnection((current) => ({ ...current, settings }));
  }, []);

  const applyApiKeyAvailability = useCallback((hasApiKey: boolean) => {
    setConnection((current) => ({ ...current, hasApiKey }));
  }, []);

  return { ...connection, applySettings, applyApiKeyAvailability };
}

function Waveform({
  level,
  active,
  compact = false,
}: {
  level: number;
  active: boolean;
  compact?: boolean;
}) {
  const normalized = clampLevel(level);
  const bars = compact ? 10 : 24;

  return (
    <div
      className={`waveform ${compact ? "waveform--compact" : ""} ${active ? "is-active" : ""}`}
      aria-hidden="true"
    >
      {Array.from({ length: bars }, (_, index) => {
        const distance = Math.abs(index - (bars - 1) / 2) / ((bars - 1) / 2);
        const threshold = Math.max(0.08, 1 - distance * 0.62);
        const lit = normalized >= threshold * 0.58;
        return <span className={lit ? "is-lit" : ""} key={index} />;
      })}
    </div>
  );
}

function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "green" | "amber" | "red" }) {
  return <span className={`tag tag--${tone}`}>{children}</span>;
}

function Notice({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "error" | "success" }) {
  const Icon = tone === "error" ? AlertCircle : tone === "success" ? Check : CircleHelp;
  return (
    <div className={`notice notice--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <Icon size={16} strokeWidth={2} />
      <span>{children}</span>
    </div>
  );
}

function App() {
  const desktop = isDesktopRuntime();
  const connection = useNativeConnection();
  const { settings, voice, hasApiKey, version, loading, error, applySettings, applyApiKeyAvailability } = connection;
  const [page, setPage] = useState<Page>("overview");
  const [pending, setPending] = useState<PendingAction>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [transcriptView, setTranscriptView] = useState<TranscriptView>("cleaned");
  const [editedText, setEditedText] = useState("");
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const [clearConfirmation, setClearConfirmation] = useState(false);
  const [micResult, setMicResult] = useState<MicrophoneProbe | null>(null);
  const nativeTranscript = useRef({ sessionId: -1, text: "" });

  const busy = isBusy(voice.phase);
  const recording = isRecordingActive(voice.phase);
  const processing = isProcessing(voice.phase);

  useEffect(() => {
    const previous = nativeTranscript.current;
    if (previous.sessionId !== voice.session_id || previous.text !== voice.text) {
      nativeTranscript.current = { sessionId: voice.session_id, text: voice.text };
      setEditedText(voice.text);
    }
  }, [voice.session_id, voice.text]);

  useEffect(() => {
    if (page !== "history" || !desktop) return;
    let current = true;
    setHistoryLoading(true);
    void listHistory()
      .then((entries) => {
        if (current) setHistoryEntries(entries);
      })
      .catch((historyError) => {
        if (current) setNotice(`Error: ${errorMessage(historyError)}`);
      })
      .finally(() => {
        if (current) setHistoryLoading(false);
      });
    return () => {
      current = false;
    };
  }, [desktop, historyEpoch, page]);

  const run = useCallback(
    async (action: Exclude<PendingAction, null>, operation: () => Promise<void>, success?: string) => {
      if (!desktop) return;
      setPending(action);
      setNotice(null);
      try {
        await operation();
        if (success) setNotice(success);
      } catch (operationError) {
        setNotice(`Error: ${errorMessage(operationError)}`);
      } finally {
        setPending(null);
      }
    },
    [desktop],
  );

  const handleCancel = useCallback(() => {
    if (!desktop || !busy || pending === "cancel") return;
    void run("cancel", cancelRecording);
  }, [busy, desktop, pending, run]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && desktop && isBusy(voice.phase)) {
        event.preventDefault();
        handleCancel();
      }
    };
    if (!desktop || !busy) return;
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, desktop, handleCancel, voice.phase]);

  const persistSettings = async (nextSettings: Settings): Promise<boolean> => {
    if (!desktop) return false;
    setPending("save-settings");
    setNotice(null);
    try {
      const saved = await saveSettings(nextSettings);
      // Backend-normalized values replace the draft immediately, including the
      // onboarding flag, so subsequent edits never begin from stale settings.
      applySettings(saved);
      setNotice(`Settings saved. ${saved.shortcut} is active.`);
      return true;
    } catch (saveError) {
      setNotice(`Error: ${errorMessage(saveError)}`);
      return false;
    } finally {
      setPending(null);
    }
  };

  const completeOnboarding = async () => {
    const completed = await persistSettings({ ...settings, onboarding_complete: true });
    if (completed) setPage("overview");
  };

  const copyCurrentText = () => {
    const text = editedText.trim();
    if (!text) return;
    void run("copy", () => copyText(text), "Copied to the Windows clipboard.");
  };

  const clearAllHistory = () => {
    void run(
      "clear-history",
      async () => {
        await clearHistory();
        setHistoryEntries([]);
        setClearConfirmation(false);
        setHistoryEpoch((epoch) => epoch + 1);
      },
      "History deleted from this device.",
    );
  };

  const addApiKey = async (key: string): Promise<boolean> => {
    if (!desktop || !key.trim()) return false;
    setPending("save-key");
    setNotice(null);
    try {
      const confirmed = await setApiKey(key.trim());
      if (!confirmed) throw new Error("The desktop service did not confirm that the API key was saved.");
      applyApiKeyAvailability(true);
      setNotice("API key saved. It is never returned to this window.");
      return true;
    } catch (keyError) {
      setNotice(`Error: ${errorMessage(keyError)}`);
      return false;
    } finally {
      setPending(null);
    }
  };

  const removeApiKey = () => {
    if (!desktop) return;
    setPending("delete-key");
    setNotice(null);
    void deleteApiKey()
      .then(() => {
        applyApiKeyAvailability(false);
        setNotice("API key removed from this device.");
      })
      .catch((deleteError) => setNotice(`Error: ${errorMessage(deleteError)}`))
      .finally(() => setPending(null));
  };

  const testMicrophone = () => {
    if (!desktop) return;
    setPending("probe-mic");
    setNotice(null);
    void probeMicrophone()
      .then((result) => {
        setMicResult(result);
        setNotice(result.detected_audio ? "Microphone detected audio." : "No speech was detected. Check your input device.");
      })
      .catch((probeError) => setNotice(`Error: ${errorMessage(probeError)}`))
      .finally(() => setPending(null));
  };

  const copyHistoryItem = (entry: HistoryEntry) => {
    void run("copy", () => copyText(entry.text), "Copied transcript to the Windows clipboard.");
  };

  const resultInsertion = insertionLabel(voice.insertion, voice.target_app);
  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Scribe Voice navigation">
        <div className="brand">
          <div className="brand__mark"><AudioLines size={20} /></div>
          <div>
            <strong>Scribe Voice</strong>
            <span>Desktop dictation</span>
          </div>
        </div>

        <nav className="sidebar__nav" aria-label="Primary">
          <NavButton active={page === "overview"} icon={<Gauge size={18} />} onClick={() => setPage("overview")}>Overview</NavButton>
          <NavButton active={page === "history"} icon={<History size={18} />} onClick={() => setPage("history")}>History</NavButton>
          <NavButton active={page === "settings"} icon={<Settings2 size={18} />} onClick={() => setPage("settings")}>Settings</NavButton>
        </nav>

        <div className="sidebar__footer">
          <div className="privacy-seal"><ShieldCheck size={17} /><span>Private by design</span></div>
          <p>Audio is processed for dictation and is never saved to disk by Scribe Voice.</p>
          <span className="version">Windows app · v{version}</span>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="topbar__title">
            <span className="eyebrow">{page === "overview" ? "Your desk" : page === "history" ? "Your archive" : "Preferences"}</span>
            <h1>{page === "overview" ? "Dictate with intention." : page === "history" ? "Transcript history" : "Make it yours."}</h1>
          </div>
          <div className="topbar__actions">
            {!desktop && <Tag tone="amber"><MonitorDown size={13} /> Browser preview</Tag>}
            {desktop && <Tag tone={hasApiKey ? "green" : "amber"}><KeyRound size={13} />{hasApiKey ? "API key connected" : "API key needed"}</Tag>}
            <button
              className="icon-button"
              type="button"
              disabled={!desktop || pending === "hide-window"}
              onClick={() => void run("hide-window", hideWindow)}
              aria-label="Hide Scribe Voice window"
              title={desktop ? "Hide window" : "Desktop API unavailable in browser preview"}
            >
              {pending === "hide-window" ? <LoaderCircle className="spin" size={17} /> : <PanelLeft size={17} />}
            </button>
          </div>
        </header>

        <div className="content-scroll" role="region" aria-label={`${page.charAt(0).toUpperCase() + page.slice(1)} content`} tabIndex={0}>
          {!desktop && (
            <Notice tone="error">
              Desktop APIs are unavailable in this browser preview. Recording, microphone tests, clipboard, settings, history, and secure key actions are disabled—nothing is simulated.
            </Notice>
          )}
          {error && <Notice tone="error">{error}</Notice>}
          {notice && <div className="toast-region" aria-live="polite"><Notice tone={notice.toLowerCase().includes("error") || notice.includes("No speech") ? "error" : "success"}>{notice}</Notice></div>}

          {loading ? (
            <div className="loading-state" role="status"><LoaderCircle className="spin" size={22} /> Connecting to desktop service…</div>
          ) : page === "overview" ? (
            <Overview
              desktop={desktop}
              settings={settings}
              voice={voice}
              hasApiKey={hasApiKey}
              busy={busy}
              recording={recording}
              processing={processing}
              pending={pending}
              transcriptView={transcriptView}
              editedText={editedText}
              micResult={micResult}
              onTranscriptView={setTranscriptView}
              onEditText={setEditedText}
              onStart={() => void run("start", startRecording)}
              onStop={() => void run("stop", stopRecording)}
              onCancel={handleCancel}
              onCopy={copyCurrentText}
              onTestMicrophone={testMicrophone}
              onOpenMicrophoneSettings={() => void run("open-mic-settings", openMicrophoneSettings)}
              onOpenSettings={() => setPage("settings")}
              onCompleteOnboarding={completeOnboarding}
              resultInsertion={resultInsertion}
            />
          ) : page === "history" ? (
            <HistoryView
              desktop={desktop}
              entries={historyEntries}
              loading={historyLoading}
              saveHistory={settings.save_history}
              clearConfirmation={clearConfirmation}
              pending={pending}
              onCopy={copyHistoryItem}
              onConfirmClear={() => setClearConfirmation(true)}
              onCancelClear={() => setClearConfirmation(false)}
              onClear={clearAllHistory}
              onOpenSettings={() => setPage("settings")}
            />
          ) : (
            <SettingsView
              desktop={desktop}
              settings={settings}
              hasApiKey={hasApiKey}
              pending={pending}
              onSave={persistSettings}
              onSetApiKey={addApiKey}
              onDeleteApiKey={removeApiKey}
              onOpenMicrophoneSettings={() => void run("open-mic-settings", openMicrophoneSettings)}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function NavButton({ active, icon, onClick, children }: { active: boolean; icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return <button className={`nav-button ${active ? "is-active" : ""}`} type="button" onClick={onClick}>{icon}<span>{children}</span></button>;
}

interface OverviewProps {
  desktop: boolean;
  settings: Settings;
  voice: VoiceState;
  hasApiKey: boolean;
  busy: boolean;
  recording: boolean;
  processing: boolean;
  pending: PendingAction;
  transcriptView: TranscriptView;
  editedText: string;
  micResult: MicrophoneProbe | null;
  resultInsertion: string | null;
  onTranscriptView: (view: TranscriptView) => void;
  onEditText: (text: string) => void;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  onCopy: () => void;
  onTestMicrophone: () => void;
  onOpenMicrophoneSettings: () => void;
  onOpenSettings: () => void;
  onCompleteOnboarding: () => void;
}

function Overview(props: OverviewProps) {
  const {
    desktop, settings, voice, hasApiKey, busy, recording, processing, pending,
    transcriptView, editedText, micResult, resultInsertion, onTranscriptView,
    onEditText, onStart, onStop, onCancel, onCopy, onTestMicrophone,
    onOpenMicrophoneSettings, onOpenSettings, onCompleteOnboarding,
  } = props;
  const startDisabled = !desktop || !hasApiKey || busy || pending !== null;
  const hasOutput = Boolean(editedText.trim() || voice.raw_text.trim());
  const statusTone = voice.phase === "error" ? "red" : recording ? "green" : processing ? "amber" : "neutral";

  return (
    <div className="overview-grid">
      <div className="overview-main">
        {!settings.onboarding_complete && (
          <OnboardingGuide
            desktop={desktop}
            hasApiKey={hasApiKey}
            pending={pending}
            onOpenSettings={onOpenSettings}
            onTestMicrophone={onTestMicrophone}
            onComplete={onCompleteOnboarding}
          />
        )}

        <section className="recording-card card" aria-labelledby="practice-heading">
          <div className="card__topline">
            <div>
              <span className="eyebrow">Practice / preview</span>
              <h2 id="practice-heading">A quieter way to capture a thought.</h2>
            </div>
            <Tag tone={statusTone}><span className={`status-dot ${recording ? "is-pulsing" : ""}`} />{phaseLabel(voice.phase)}</Tag>
          </div>

          <div className="recording-stage">
            <div className={`recording-orb ${recording ? "is-recording" : ""} ${processing ? "is-processing" : ""}`}>
              {processing ? <Sparkles size={30} /> : recording ? <Mic size={31} /> : <AudioLines size={30} />}
            </div>
            <div className="recording-readout">
              <strong>{voiceMessage(voice)}</strong>
              <span>{recording ? `${formatDuration(voice.duration_ms)} · hard stop at 02:00` : processing ? "Please keep this window open while your words are prepared." : "Practice stays here for review. It never auto-sends or auto-inserts."}</span>
            </div>
            <Waveform level={voice.level} active={recording || processing} />
          </div>

          <div className="recording-actions">
            {!busy ? (
              <button className="button button--primary" type="button" disabled={startDisabled} onClick={onStart}>
                {pending === "start" ? <LoaderCircle className="spin" size={17} /> : <Play size={17} fill="currentColor" />}
                Start practice
              </button>
            ) : recording ? (
              <>
                <button className="button button--primary" type="button" disabled={!desktop || pending !== null} onClick={onStop}>
                  {pending === "stop" ? <LoaderCircle className="spin" size={17} /> : <Square size={15} fill="currentColor" />}
                  Stop & preview
                </button>
                <button className="button button--quiet" type="button" disabled={!desktop || pending !== null} onClick={onCancel}>
                  <X size={17} /> Cancel <kbd>Esc</kbd>
                </button>
              </>
            ) : (
              <button className="button button--quiet" type="button" disabled={!desktop || pending !== null} onClick={onCancel}>
                {pending === "cancel" ? <LoaderCircle className="spin" size={17} /> : <X size={17} />} Cancel processing <kbd>Esc</kbd>
              </button>
            )}
            {!hasApiKey && <button className="text-button" type="button" onClick={onOpenSettings}>Add an API key <ChevronRight size={15} /></button>}
          </div>
          <p className="practice-note"><LockKeyhole size={14} /> This is a review-only practice capture. Only the global shortcut can target another app, and it verifies focus before it ever pastes.</p>
        </section>

        <section className="transcript-card card" aria-labelledby="transcript-heading">
          <div className="card__topline transcript-head">
            <div>
              <span className="eyebrow">Transcript preview</span>
              <h2 id="transcript-heading">Edit before you use it.</h2>
            </div>
            <div className="segmented" aria-label="Transcript version">
              <button type="button" className={transcriptView === "cleaned" ? "is-selected" : ""} onClick={() => onTranscriptView("cleaned")}>Cleaned</button>
              <button type="button" className={transcriptView === "raw" ? "is-selected" : ""} onClick={() => onTranscriptView("raw")}>Raw</button>
            </div>
          </div>

          {transcriptView === "cleaned" ? (
            <textarea
              className="transcript-editor"
              value={editedText}
              onChange={(event) => onEditText(event.target.value)}
              aria-label="Editable cleaned transcript"
              placeholder="Your practice transcript will appear here after processing."
              spellCheck
            />
          ) : (
            <div className="raw-transcript" aria-label="Raw transcript">
              {voice.raw_text || "The unedited recognition will appear here. Raw text is kept separate from your cleaned, editable preview."}
            </div>
          )}

          <div className="transcript-footer">
            <div className="result-note">
              {resultInsertion ? <><Check size={15} /> {resultInsertion}</> : <><Clipboard size={15} /> Review and copy when ready. No text is sent automatically.</>}
            </div>
            <button className="button button--secondary" type="button" disabled={!desktop || !hasOutput || pending !== null} onClick={onCopy}>
              {pending === "copy" ? <LoaderCircle className="spin" size={16} /> : <Copy size={16} />} Copy text
            </button>
          </div>
        </section>
      </div>

      <aside className="overview-side">
        <section className="status-card card" aria-label="Live session status">
          <div className="side-heading"><Volume2 size={17} /><span>Live status</span></div>
          <div className="status-primary"><span className={`status-dot status-dot--large ${recording ? "is-pulsing" : ""}`} /><strong>{phaseLabel(voice.phase)}</strong></div>
          <dl className="status-list">
            <div><dt>Duration</dt><dd>{formatDuration(voice.duration_ms)}</dd></div>
            <div><dt>Mode</dt><dd>{settings.activation_mode === "hold" ? "Hold to talk" : "Toggle"}</dd></div>
            <div><dt>Shortcut</dt><dd><kbd>{settings.shortcut}</kbd></dd></div>
          </dl>
          {voice.target_app && <p className="target-app">Target: <strong>{voice.target_app}</strong></p>}
        </section>

        <LastRecordingRecognitionDiagnostic voice={voice} />

        <section className="mic-card card" aria-labelledby="mic-heading">
          <div className="side-heading"><Mic size={17} /><span id="mic-heading">Microphone check</span></div>
          <p>Tests about 1.2 seconds of local input, then discards it. Nothing is transcribed or retained.</p>
          <button className="button button--secondary button--full" type="button" disabled={!desktop || pending !== null} onClick={onTestMicrophone}>
            {pending === "probe-mic" ? <LoaderCircle className="spin" size={16} /> : <Waves size={16} />} Test microphone
          </button>
          {micResult && (
            <div className={`mic-result ${micResult.detected_audio ? "is-good" : "is-warning"}`}>
              <span>{micResult.detected_audio ? "Audio detected" : "No audio detected"}</span>
              <small>{micResult.device_name} · peak {Math.round(clampLevel(micResult.peak_level) * 100)}%</small>
            </div>
          )}
          <button className="text-button text-button--muted" type="button" disabled={!desktop || pending !== null} onClick={onOpenMicrophoneSettings}>Open Windows microphone settings <ChevronRight size={14} /></button>
        </section>

        <section className="cloud-card card">
          <Cloud size={18} />
          <div><strong>Cloud transcription, clearly stated.</strong><p>Your speech is sent to the selected transcription provider only to create your text. Audio is never saved to disk by this app.</p></div>
        </section>
      </aside>
    </div>
  );
}

export function LastRecordingRecognitionDiagnostic({ voice }: { voice: VoiceState }) {
  if (voice.session_id <= 0 || !voice.transcription_model) return null;

  const languageCode = voice.language_hint || "auto";
  const languageLabel = languageCode === "auto" ? "Auto" : recognitionLanguageLabel(languageCode);

  return (
    <section className="status-card card" aria-label="Last recording recognition diagnostic">
      <div className="side-heading"><Sparkles size={17} /><span>Last recording recognition</span></div>
      <dl className="status-list">
        <div><dt>Language hint</dt><dd>{languageLabel} (<code>{languageCode}</code>)</dd></div>
        <div><dt>Model</dt><dd><code>{voice.transcription_model}</code></dd></div>
      </dl>
    </section>
  );
}

function OnboardingGuide({ desktop, hasApiKey, pending, onOpenSettings, onTestMicrophone, onComplete }: {
  desktop: boolean;
  hasApiKey: boolean;
  pending: PendingAction;
  onOpenSettings: () => void;
  onTestMicrophone: () => void;
  onComplete: () => void;
}) {
  return (
    <section className="onboarding card" aria-labelledby="onboarding-heading">
      <div className="onboarding__intro"><span className="eyebrow">First-run guide</span><h2 id="onboarding-heading">Set yourself up in four small steps.</h2><p>Scribe Voice is deliberate: you remain in control of where every transcript goes.</p></div>
      <ol className="setup-steps">
        <li className={hasApiKey ? "is-complete" : ""}><span>1</span><div><strong>Connect your API key</strong><small>{hasApiKey ? "Connected securely" : "Needed to transcribe"}</small></div><button className="step-link" type="button" onClick={onOpenSettings}>{hasApiKey ? "Review" : "Add"}</button></li>
        <li><span>2</span><div><strong>Check your microphone</strong><small>A short local test; audio is discarded</small></div><button className="step-link" type="button" disabled={!desktop || pending !== null} onClick={onTestMicrophone}>Test</button></li>
        <li><span>3</span><div><strong>Choose your shortcut</strong><small>Toggle or hold-to-talk in Settings</small></div><button className="step-link" type="button" onClick={onOpenSettings}>Choose</button></li>
        <li><span>4</span><div><strong>Try a private preview</strong><small>Edit and copy it yourself</small></div><span className="step-ready">Ready</span></li>
      </ol>
      <div className="onboarding__footer"><span><ShieldCheck size={15} /> Text history stays off unless you opt in.</span><button className="button button--primary" type="button" disabled={!desktop || pending !== null} onClick={onComplete}>Finish setup <ChevronRight size={16} /></button></div>
    </section>
  );
}

function HistoryView({ desktop, entries, loading, saveHistory, clearConfirmation, pending, onCopy, onConfirmClear, onCancelClear, onClear, onOpenSettings }: {
  desktop: boolean;
  entries: HistoryEntry[];
  loading: boolean;
  saveHistory: boolean;
  clearConfirmation: boolean;
  pending: PendingAction;
  onCopy: (entry: HistoryEntry) => void;
  onConfirmClear: () => void;
  onCancelClear: () => void;
  onClear: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="history-page">
      <section className="history-intro card">
        <div><span className="eyebrow">Local text archive</span><h2>Your words, kept only if you choose.</h2><p>Audio is never saved to disk. When enabled, Scribe Voice stores only text transcripts on this device, up to the latest 50.</p></div>
        <div className="history-intro__actions">
          <Tag tone={saveHistory ? "green" : "neutral"}>{saveHistory ? "History saving on" : "History saving off"}</Tag>
          <button className="button button--secondary" type="button" onClick={onOpenSettings}><SlidersHorizontal size={16} /> Privacy settings</button>
        </div>
      </section>

      {clearConfirmation && (
        <section className="confirm-strip" role="alert">
          <AlertCircle size={18} /><span>Delete all saved transcript text from this device? This cannot be undone.</span>
          <div><button className="button button--danger" type="button" disabled={!desktop || pending === "clear-history"} onClick={onClear}>{pending === "clear-history" ? <LoaderCircle className="spin" size={15} /> : <Trash2 size={15} />} Delete all</button><button className="button button--quiet" type="button" disabled={pending === "clear-history"} onClick={onCancelClear}>Cancel</button></div>
        </section>
      )}

      <section className="history-list card" aria-label="Saved transcript history">
        <div className="card__topline"><div><span className="eyebrow">Latest 50</span><h2>Saved transcripts</h2></div>{entries.length > 0 && !clearConfirmation && <button className="text-button text-button--danger" type="button" disabled={!desktop} onClick={onConfirmClear}><Trash2 size={15} /> Delete all</button>}</div>
        {!desktop ? (
          <div className="empty-state"><div className="empty-state__icon"><MonitorDown size={25} /></div><h3>History is unavailable in preview</h3><p>Open Scribe Voice in the Windows desktop app to read or delete locally saved transcript text.</p></div>
        ) : loading ? <div className="loading-state"><LoaderCircle className="spin" size={20} /> Loading text history…</div> : entries.length === 0 ? (
          <div className="empty-state"><div className="empty-state__icon"><History size={25} /></div><h3>No saved transcripts</h3><p>{saveHistory ? "Your next completed dictation can appear here." : "History is currently off. Turn it on only if keeping text locally works for you."}</p>{!saveHistory && <button className="button button--secondary" type="button" onClick={onOpenSettings}>Review privacy setting <ChevronRight size={16} /></button>}</div>
        ) : <div className="history-rows">{entries.map((entry) => <article className="history-row" key={entry.id}><div className="history-row__meta"><time dateTime={entry.created_at}>{readableDate(entry.created_at)}</time><span>{entry.model.replace("openai/", "")}</span><span>{entry.insertion.replace("_", " ")}</span></div><p>{entry.text || entry.raw_text}</p><button className="icon-button" type="button" disabled={!desktop || pending !== null} onClick={() => onCopy(entry)} aria-label="Copy saved transcript"><Copy size={16} /></button></article>)}</div>}
      </section>
    </div>
  );
}

export function SettingsView({ desktop, settings, hasApiKey, pending, onSave, onSetApiKey, onDeleteApiKey, onOpenMicrophoneSettings }: {
  desktop: boolean;
  settings: Settings;
  hasApiKey: boolean;
  pending: PendingAction;
  onSave: (settings: Settings) => Promise<boolean>;
  onSetApiKey: (key: string) => Promise<boolean>;
  onDeleteApiKey: () => void;
  onOpenMicrophoneSettings: () => void;
}) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [apiKey, setApiKey] = useState("");
  const [keyMessage, setKeyMessage] = useState<string | null>(null);

  useEffect(() => setDraft(settings), [settings]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings]);
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const useGuidedEnglishRecognition = () => setDraft((current) => ({
    ...current,
    language: "en",
    transcription_model: "google/gemini-2.5-flash",
  }));

  const submitSettings = async () => {
    const language = normalizeRecognitionLanguage(draft.language);
    if (language === null) return;
    await onSave({ ...draft, language });
  };

  const submitKey = async () => {
    setKeyMessage(null);
    const saved = await onSetApiKey(apiKey);
    if (saved) {
      setApiKey("");
      setKeyMessage("Key saved securely. The value is no longer held in this form.");
    }
  };

  return (
    <div className="settings-page">
      <section className="settings-intro card"><div><span className="eyebrow">Control, with context</span><h2>Set your pace and your privacy.</h2><p>Settings are saved only through the Windows desktop service. Shortcut conflicts are checked by the backend before a change is accepted.</p></div><LockKeyhole size={27} /></section>

      <div className="settings-grid">
        <section className="settings-card card" aria-labelledby="dictation-settings"><div className="card__topline"><div><span className="eyebrow">Dictation</span><h2 id="dictation-settings">Shortcut & behaviour</h2></div><Keyboard size={20} /></div>
          <label className="field"><span>Global shortcut</span><input value={draft.shortcut} onChange={(event) => update("shortcut", event.target.value)} disabled={!desktop || pending !== null} aria-describedby="shortcut-help" /><small id="shortcut-help">Use a unique Windows shortcut. Any conflict is returned here when you save.</small></label>
          <fieldset className="radio-group"><legend>Activation mode</legend><label><input type="radio" name="activation" checked={draft.activation_mode === "toggle"} onChange={() => update("activation_mode", "toggle")} disabled={!desktop || pending !== null} /><span><strong>Toggle</strong><small>Press once to start, once to stop.</small></span></label><label><input type="radio" name="activation" checked={draft.activation_mode === "hold"} onChange={() => update("activation_mode", "hold")} disabled={!desktop || pending !== null} /><span><strong>Hold to talk</strong><small>Release the shortcut to stop.</small></span></label></fieldset>
          <button className="text-button text-button--muted" type="button" disabled={!desktop || pending !== null} onClick={onOpenMicrophoneSettings}><Mic size={15} /> Open Windows microphone settings <ChevronRight size={14} /></button>
        </section>

        <section className="settings-card card" aria-labelledby="models-settings"><div className="card__topline"><div><span className="eyebrow">Language & AI</span><h2 id="models-settings">Transcription choices</h2></div><Sparkles size={20} /></div>
          <RecognitionLanguageField value={draft.language} onChange={value => update("language", value)} disabled={!desktop || pending !== null} />
          <label className="field"><span>Transcription model</span><select value={draft.transcription_model} onChange={(event) => update("transcription_model", event.target.value as Settings["transcription_model"])} disabled={!desktop || pending !== null}><option value="openai/gpt-4o-mini-transcribe">GPT-4o mini Transcribe — faster</option><option value="openai/gpt-4o-transcribe">GPT-4o Transcribe — higher fidelity</option><option value="google/gemini-2.5-flash">Gemini 2.5 Flash — guided audio</option></select></label>
          <button className="text-button" type="button" disabled={!desktop || pending !== null} onClick={useGuidedEnglishRecognition}>Use guided English recognition</button>
          <p className="settings-copy">This only changes the draft: Save changes is required. Guided audio sends the original audio with your language instructions; it does not translate an existing transcript. It uses a different model/provider with separate token billing and may take longer. There is no automatic retry or accuracy guarantee.</p>
          <label className="toggle-row"><span><strong>Clean up transcript</strong><small>Use {draft.cleanup_model.replace("openai/", "")} to improve punctuation and flow.</small></span><input type="checkbox" checked={draft.cleanup_enabled} onChange={(event) => update("cleanup_enabled", event.target.checked)} disabled={!desktop || pending !== null} /><i aria-hidden="true" /></label>
        </section>

        <section className="settings-card card settings-card--wide" aria-labelledby="privacy-settings"><div className="card__topline"><div><span className="eyebrow">Privacy & storage</span><h2 id="privacy-settings">Keep only what you mean to.</h2></div><ShieldCheck size={20} /></div>
          <div className="cloud-notice"><Cloud size={18} /><div><strong>Cloud processing</strong><p>Audio is sent to your selected AI provider for transcription. Scribe Voice never saves audio to disk. Review your provider’s data policy for their processing terms.</p></div></div>
          <label className="toggle-row"><span><strong>Save transcript history on this device</strong><small>Off by default. When on, only text—not audio—is kept locally, up to the last 50 items.</small></span><input type="checkbox" checked={draft.save_history} onChange={(event) => update("save_history", event.target.checked)} disabled={!desktop || pending !== null} /><i aria-hidden="true" /></label>
        </section>

        <section className="settings-card card settings-card--wide" aria-labelledby="key-settings"><div className="card__topline"><div><span className="eyebrow">Connection</span><h2 id="key-settings">API key</h2></div><KeyRound size={20} /></div>
          <p className="settings-copy">{hasApiKey ? "A key is connected. For your safety, its value is never returned to this window." : "Add a key to enable cloud transcription. It is never stored in browser storage."}</p>
          <div className="key-row"><label className="field"><span className="sr-only">API key</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={hasApiKey ? "Replace with a new API key" : "Paste API key"} autoComplete="new-password" autoCapitalize="none" spellCheck={false} disabled={!desktop || pending !== null} /></label><button className="button button--secondary" type="button" disabled={!desktop || !apiKey.trim() || pending !== null} onClick={submitKey}>{pending === "save-key" ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Save key</button>{hasApiKey && <button className="button button--quiet button--danger-text" type="button" disabled={!desktop || pending !== null} onClick={onDeleteApiKey}>{pending === "delete-key" ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />} Remove</button>}</div>
          {keyMessage && <p className="inline-success"><Check size={15} /> {keyMessage}</p>}
        </section>
      </div>

      <div className="settings-savebar"><span>{normalizeRecognitionLanguage(draft.language) === null ? "Choose a valid spoken-language hint before saving." : dirty ? "You have unsaved changes." : "All settings are up to date."}</span><button className="button button--primary" type="button" disabled={!desktop || !dirty || pending !== null || normalizeRecognitionLanguage(draft.language) === null} onClick={submitSettings}>{pending === "save-settings" ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />} Save changes</button></div>
    </div>
  );
}

/** Minimal transparent overlay used by the separate click-through Tauri window. */
export function Overlay() {
  const desktop = isDesktopRuntime();
  const { voice, loading, error } = useNativeConnection();
  const busy = isBusy(voice.phase);
  const processing = isProcessing(voice.phase);

  useEffect(() => {
    document.body.classList.add("overlay-page");
    return () => document.body.classList.remove("overlay-page");
  }, []);

  return (
    <main className="overlay-shell" aria-live="polite" aria-label="Scribe Voice recording status">
      <section className={`overlay-pill ${busy ? "is-busy" : ""} ${voice.phase === "error" ? "is-error" : ""}`}>
        <div className="overlay-pill__icon">{loading ? <LoaderCircle className="spin" size={16} /> : processing ? <Sparkles size={16} /> : <Mic size={16} />}</div>
        <div className="overlay-pill__copy"><strong>{desktop ? voiceMessage(voice) : "Desktop APIs unavailable"}</strong><span>{desktop ? (isRecordingActive(voice.phase) ? `${formatDuration(voice.duration_ms)} · Press Esc to cancel` : processing ? "Processing your preview · Esc cancels" : voice.phase === "error" ? error || "Open Scribe Voice for details" : "Waiting for your shortcut") : "Open in the Windows desktop app"}</span></div>
        {desktop && <Waveform level={voice.level} active={busy} compact />}
      </section>
    </main>
  );
}

export default App;
