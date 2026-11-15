# Architecture

## Runtime boundary

React renders settings, onboarding, practice, transcripts, history, and the compact overlay. It calls typed Tauri commands through `src/bridge.ts` and subscribes to `voice-state` and `voice-level` events. It never stores the API key in browser storage. A normal browser receives an explicitly disabled preview, not a fake desktop implementation.

Rust owns the microphone, session state, credentials, network calls, SQLite storage, and system input. Hiding or closing the main window does not end an ongoing recording because recording is not tied to a React component. Quit from the tray ends the process. There are no background microphones opened merely at startup.

## Recording state machine

```text
idle / done / error / cancelled
              │ explicit shortcut or practice Start
              ▼
           starting ── mic error ──► error
              ▼
           recording ── Cancel ────► cancelled
              │ Stop / key release / 120-second cap
              ▼
          transcribing ── failure ─► error
              │
              ├─ cleanup off ───────────────┐
              ▼                            │
           cleaning ── failure uses raw ────┤
              ▼                            ▼
        done: preview / paste sent / copy required
```

Each session has a monotonically increasing ID, settings snapshot, captured target, and cancellation signal. Native start/stop/cancel commands are serialized to prevent a late audio-start task reopening a cancelled session. Network results are accepted only for the currently active uncancelled session. Cancellation drops the request future and abandons later results; it cannot retract content already sent upstream.

`audio.rs` contains a dedicated worker thread because Windows microphone streams need to remain owned by their recording context rather than the UI. It captures the default device, downmixes channels, emits level events, limits samples to 120 seconds, and builds a 16-kHz mono 16-bit WAV in a memory buffer. The microphone test uses the same path but never calls the AI provider. The current linear resampling should be upgraded before quality-critical production use.

## AI boundary

`ai.rs` uses a certificate-verifying Rustls HTTP client, a 12-second connection timeout and 60-second overall timeout. Transcription sends a multipart WAV to the OpenRouter transcription endpoint. Cleanup sends the transcript to a separate text model. Only the listed models/languages are accepted by settings validation. Paid AI requests are not automatically retried.

The cleanup system instruction treats dictated text as untrusted source material rather than commands. Empty, truncated, and extreme-length outputs are rejected, preserving the raw text. These checks do not prove semantic fidelity. Model tests with user-specific speech and terms are still required.

Credential storage uses the current Windows user's Credential Manager via `keyring`. The UI only receives a boolean for key availability. Network/provider errors are mapped to readable messages without exposing response bodies or keys.

## Focus and insertion boundary

Only a global shortcut captures an external target. The practice Start command cannot request automatic insertion. The Windows adapter captures foreground HWND, focused-control HWND, process ID, and the UI Automation runtime identity. It reads only identity/password flags, not the target field's content or accessible name. Recognized terminal processes, protected password fields, missing control focus, and inaccessible UIA targets are copy-only.

Before pasting, the adapter waits briefly for shortcut modifiers to be released and rechecks the original window/control/UIA identity. It sets clipboard text and emits only `Ctrl+V`; it never emits Enter. If the target changes, it retains the result. Simulated input delivery does not prove acceptance by the target app. Windows privilege boundaries, custom controls, browser focus races, and slow clipboard consumers can prevent insertion. This is not an atomic cross-process text transaction.

Previous plain-text clipboard contents are restored after a short delay if the clipboard sequence remains unchanged. Non-text formats are not restored. For production, full clipboard-format preservation, reliable application-specific adapters, and OS integration tests are priorities.

## Persistence and privacy

SQLite stores preferences and, only when opted in, at most 50 raw/final text entries. Audio is not intentionally persisted by the application. The database is not encrypted; `secure_delete` and vacuum are used for local history removal but do not control filesystem backups or SSD behavior. Credentials are separate. There is no application telemetry, account service, or bundled vendor API key.

The recording overlay is a separate non-focusable, topmost, click-through webview window. It receives the same state events as the main window. It is placed near the bottom of the primary monitor; per-monitor cursor-aware placement is future work. Global Escape is registered only during a session and released afterward.

## Suggested next increments

First validate real dictation and insertion in the target app shortlist. Then add a band-limited resampler, selected microphone devices, streaming recognition if needed, a personal vocabulary layer, an explicit review-before-insert mode, full clipboard preservation, better UIA timeouts, signed installer/updater, and macOS native adapters. Do not add account/backend infrastructure until distribution and billing requirements justify it.

## Opt-in startup diagnostics

When a developer explicitly sets `SCRIBE_VOICE_DATA_DIR`, startup writes stage-only diagnostics to `startup.log` in that overridden directory. No field contents, audio, transcripts, or keys are included. Ordinary runs without the override do not write this diagnostic log. This helps distinguish pre-WebView initialization stalls from database/setup failures.

## Version 0.1.1: shortcut and instance reliability

`single_instance.rs` establishes a named Windows mutex before the webview/runtime starts. The handle remains alive while the app is running; a second updated process exits after attempting to show the existing window. Earlier MVP builds did not hold this mutex, so an existing main window triggers a one-time legacy-copy warning instead of another hotkey-owning app. The warning releases the mutex before showing its dialog and never stops other processes automatically. The guard is local to the Windows logon session.

`shortcut_binding.rs` owns a testable rebinding transaction: reuse a combination already owned by this instance, register a free candidate before releasing the previous key, persist settings, and restore the previous binding/remove the candidate on persistence failure. OS registration failures are mapped to readable messages rather than dumping internal modifier/key IDs. Another application's hotkey is never forcibly claimed.

Settings updates run on a blocking worker and are serialized separately from voice-state access. The controller lock is released during main-thread registration calls to avoid a hotkey callback/registration lock inversion. A short update flag prevents recording/probes from starting halfway through a change. Shortcut errors are tracked separately so successful recovery clears only that error, preserves transcript text, and does not erase unrelated microphone/AI failures. The frontend receives the recovery event and confirms the active saved key.

## Version 0.1.2: recognition-language hints

`src/data/languages.json` is shared by TypeScript and Rust (`include_str!`) and carries 183 standard two-letter codes, friendly names, and unambiguous aliases. Its provenance is in `src/data/LANGUAGE_CATALOG.md`. No name-resolution service or LLM call is used to choose a hint. Codes/names take precedence over aliases, and the generated dataset prevents locale aliases from overriding distinct ISO names.

`RecognitionLanguageField.tsx` exposes Auto versus a typeable manual hint. Invalid or incomplete entries block Save. The UI converts recognized input to a canonical code; native settings save normalizes again before hotkey/persistence work. The saved schema still uses the existing `language` string, so old Auto/en/zh preferences require no database migration.

`languages.rs::hint` returns `None` for Auto and a validated code otherwise. `ai.rs::transcription_form` omits the field for None and adds `language` only for a real hint. A localhost wire-format unit test exercises this same builder without an API key or microphone. The cleanup prompt and output language policy are unchanged: no translation. Model errors now suggest trying Auto if the provider rejects language options. Paid requests are not automatically retried.

## Version 0.1.3: query-safe searchable combobox

`RecognitionLanguageField` maintains live `query` separately from the controlled preference `value`. A last-emitted-value marker distinguishes the component's own keystrokes from external/saved updates, so exact two-letter prefixes are not reformatted while typing. Explicit result selection sets the display name and emits the canonical code; direct recognized names/codes still use the existing validation/save path. Auto/manual toggling retains the last typed hint.

`searchRecognitionLanguages` ranks matches by name prefix, exact code, alias prefix, then contains matches. Search folding is case/accent-insensitive; canonical API validation is unchanged and remains stricter than searching. The listbox is application-controlled, with combobox ARIA relationships, mouse selection, Arrow/Enter navigation, Escape dismissal, and highlight scrolling. No provider call is used for searching.

## Version 0.1.4: instruction-carrying audio and English safeguards

The `transcription_model` allowlist now includes `google/gemini-2.5-flash`, without changing the existing default. `ai::transcribe` dispatches that choice to `/chat/completions` with original in-memory WAV bytes encoded as `input_audio` plus explicit transcription-only language instructions. Standard OpenAI transcription models still use multipart `/audio/transcriptions`; no ignored ordinary STT prompt is added. Guided mode requests a strict `{text, language, speech_detected}` JSON object with compatible-provider routing. It fails conservatively on missing/malformed/truncated/no-speech results and never retries automatically.

`Transcript` carries raw text and an optional model language report. The controller publishes Raw, then calls `language_guard::check` before cleanup or the paste branch. During an English (`en`) session, incompatible script proportions or a conflicting model language report stop processing with Raw preserved. The script heuristic cannot independently identify every language, especially Latin-script languages. The model report is not a separate confidence measurement.

English cleanup uses the same existing request to return `{text, source_language, output_language}`. A non-English source produces a typed `CleanupResult::SourceLanguageMismatch`, which stops the controller rather than falling back to and automatically pasting that mismatched Raw. An output-language change or cleanup failure discards the cleanup, retaining Raw with a warning. Non-English/Auto cleanup keeps the prior plain-text path. There are no extra classifier API requests or post-transcription translation calls.

`VoiceState.language_hint` and `VoiceState.transcription_model` are snapshotted from the saved settings at recording start. UI diagnostics render those values, not the current unsaved draft. Added state fields have deserialization defaults, and existing preference JSON/schema remains compatible. The guided English preset changes only the draft language and model, requiring explicit Save. Credentials, history defaults, audio retention, cancellation, shortcut ownership, and focus-safe insertion stay unchanged.
