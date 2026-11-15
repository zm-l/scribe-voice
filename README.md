# Scribe Voice — Windows desktop MVP

Scribe Voice is a Windows-first desktop dictation app built with Tauri 2, React, TypeScript, and Rust. Put a cursor in another app, trigger a global shortcut, speak, and finish. It transcribes through OpenRouter, optionally cleans the text, and attempts a controlled paste into the original input. If the target cannot be identified safely or the focus changes, the result remains available in Scribe Voice to copy manually.

This is a bring-your-own-key MVP, not a hosted service. No backend server, account, or `.env` file is required. The native Rust process makes OpenRouter requests; your key is not embedded in the React bundle.

## Start the supplied Windows build

Quit the current Scribe app through its tray icon's **Quit** menu (and stop any development terminal with Ctrl+C), then double-click `windows/Scribe-Voice-v0.1.4.exe` in Windows Explorer. This is **version 0.1.4**, adding opt-in guided audio recognition, English-session language safeguards, and actual recording-language/model diagnostics. The current v0.1.3 app was not stopped or overwritten; do not reopen older executable filenames for this update. Check that the sidebar reports **v0.1.4**: if an earlier version appears, the instance guard has reopened an old app that is still running. This is a development-profile MVP test build, not an optimized release or signed installer. It embeds the frontend and does not need Node or Rust at runtime. Microsoft Edge WebView2 must be installed. Review your organization's security policy rather than disabling system protections for an unsigned executable.

**Validation status:** your screenshot confirms that the native app opens and displays Settings in your normal desktop session. The earlier automated launch check stalled before setup, which remains recorded as an automated-test limitation. The scrolling fix has passed layout regression checks and a real browser wheel gesture using the same rebuilt UI assets. Live recognition quality and cross-app insertion still require your microphone, key, and application acceptance tests; see `docs/VALIDATION.md`.

Once onboarding appears, add your OpenRouter key inside the app, explicitly test the microphone, save a shortcut, and complete a practice recording. The app does not start recording just because it launched.

Closing the window hides it to the notification-area tray; it does not quit the app. Open the tray menu to reopen Scribe Voice, cancel dictation, or Quit. Check the hidden tray icons if you cannot see the microphone icon. Versions 0.1.1 and later hold the same Windows instance guard; opening an updated executable again attempts to reopen the existing main window instead of registering a second copy. Quit the previous version before upgrading. If a pre-guard build is detected, the updated app explains how to quit it and does not silently run alongside it. Saved settings and the Credential Manager key use the unchanged app identifier. Saving a working shortcut clears its earlier registration error and confirms which combination is active. A genuinely unavailable shortcut is rejected without overriding another application.

## Auto-detect or hint the spoken language

Open **Settings → Language & AI → Spoken-language recognition**. **Auto-detect** is the default and sends no `language` field to the transcription API. The speech model infers the language from your audio. Keep this mode when unsure or when switching/mixing languages.

To provide a hint, choose **Hint the spoken language**, then search by name, code, or alias. For example, type `ch` to see Chinese alongside Chamorro and other matches; continue typing `chi` or select **Chinese (zh)**. Search text is never automatically expanded while you type. Click a result, or use Arrow keys and Enter, then click **Save changes**. Complete recognized names or explicit codes can also be entered directly. Suggestions use a shared catalog of 183 standard codes and support case-insensitive English/native names and aliases. The field shows the exact API hint, such as `zh` or `ja`. Arbitrary text, unsupported region/dialect tags, and unknown entries are rejected before saving or sending a request. Your previous Auto/English/Chinese preference remains valid.

The hint describes what you are speaking; it does **not** translate the output. Cleanup also preserves the original language choices. A correct input-language hint can help recognition for a known single language, but neither hint mode nor Auto guarantees higher accuracy. Model language and dialect support varies; a valid standard code is not a promise of model coverage. If the provider rejects a hint or recognition becomes worse, switch back to Auto-detect. See the [OpenRouter STT documentation](https://openrouter.ai/docs/guides/overview/multimodal/stt) and [OpenAI language-parameter reference](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create).

## Recommended IDE

Use **Visual Studio Code** for everyday development. Open this project's folder, not just the `src` subfolder. The `.vscode/extensions.json` file recommends rust-analyzer, the Tauri extension, Prettier, ESLint, and CodeLLDB. rust-analyzer and the Tauri extension are the most important. ESLint is optional; this MVP uses TypeScript checks and tests and does not include an ESLint ruleset.

Visual Studio **2022** and Visual Studio **Code** are different products. VS Code is the editor. The Visual Studio C++ workload supplies the Windows compiler and SDK required by Rust/Tauri. You do not need to use the full Visual Studio IDE to edit this project.

If the `code` command is installed:

```powershell
cd "C:\Users\storm\OneDrive\Documents\manus\outputs\scribe-voice"
code .
```

Otherwise use VS Code → File → Open Folder. A shorter local folder such as `C:\dev\scribe-voice` is also fine. Copy the source folder there if OneDrive synchronization slows builds; do not move other user files.

## Developer prerequisites

For a normal developer setup, install Node.js LTS, current stable Rust for `x86_64-pc-windows-msvc`, Visual Studio 2022 with **Desktop development with C++**, and the Windows 10/11 SDK. Microsoft Edge WebView2 is needed for the desktop UI. Rust should be at least 1.90 for this project's declared minimum, but use current stable because pinned transitive dependencies can have higher requirements. Use MSVC Rust, not GNU Rust.

Official setup reference: https://v2.tauri.app/start/prerequisites/ . Rust installer: https://rustup.rs/ . VS Code: https://code.visualstudio.com/ . WebView2: https://developer.microsoft.com/en-us/microsoft-edge/webview2/ .

Verify in a **new PowerShell terminal** after installation:

```powershell
node --version
npm --version
rustc --version
cargo --version
rustup show active-toolchain
```

This task also prepared a workspace-local Rust toolchain for build validation without modifying your system PATH. The optional `scripts/Start-Desktop.ps1` helper can use it while the project remains under this task folder. It is not included in the source ZIP; on another computer, install Rust normally.

## Run in development mode

From the source project's root:

```powershell
npm ci
npm run desktop:dev
```

Keep the terminal open. The launcher tries port 1420, automatically chooses another free port if needed, starts exactly one owned frontend server, waits for its readiness, and passes the matching URL/CSP to Tauri for this run. It does not kill an existing listener or rewrite the base Tauri config. Ctrl+C stops the launcher's own frontend and desktop process trees.

The first native build can take several minutes and download a substantial dependency cache. Later runs reuse compiled dependencies. React changes rebuild through Vite/Rollup and reload the full page; native Rust changes rebuild the desktop process. Full-page reload resets unsaved UI drafts, so save settings before editing source. The default avoids esbuild dependency-optimizer ancestor scans in restricted Windows workspaces. `npm run dev:hmr` remains available as a standalone UI-only alternative on unrestricted developer machines; the managed desktop launcher uses build-watch/full-page reload.

On the original task workspace, if Rust is not on PATH, use the helper:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-Desktop.ps1
```

The execution-policy override applies only to that process. Do not change the machine-wide policy. The helper selects normal Rust if available, otherwise the workspace-local cached toolchain, checks prerequisites, installs npm dependencies only if they are absent, and launches desktop development. The helper uses cached Cargo dependencies offline only for the workspace-local validation toolchain.

`npm run dev` opens only the Vite web UI at `http://127.0.0.1:1420`. A normal browser **cannot** use global shortcuts, native microphone capture, credential storage, or cross-app insertion. The UI marks this as preview mode and disables native actions. To test real functionality, use `npm run desktop:dev` or the Windows executable.

## First successful try

1. Open Scribe Voice and read the cloud-processing notice. In the API-key field, enter your OpenRouter key and save it. The key is stored in Windows Credential Manager; the app never reads it back into the UI. Saving the key checks local storage, not whether the provider will accept it. The first transcription validates network access and account credits.
2. Click the microphone test deliberately and speak while it runs for approximately 1.4 seconds. The test captures locally and discards the samples without calling OpenRouter. If necessary, open Windows microphone privacy settings and enable **Microphone access** and **Let desktop apps access your microphone**. Windows does not use macOS-style Accessibility permission onboarding for this MVP.
3. Choose a shortcut. The default is `Ctrl+Shift+Space`. If another app owns it, select a different modified shortcut, for example `Ctrl+Alt+D`. Save the setting. Escape is reserved for cancellation.
4. Click Start in the app's practice panel, say a short sentence, then Stop. Wait for the real transcript. Practice never auto-pastes into another application. Review/edit the result and use Copy.
5. For a real cross-app try, open **Notepad**, click in its text area, and leave focus there. Trigger the global shortcut, speak, and finish. Do not switch windows or click another field while waiting. Review the resulting text. If it was not pasted, reopen Scribe Voice and use Copy.

The app sends a paste shortcut, not Enter. It does not intentionally send messages or submit forms. Automatic insertion is disabled for recognized terminal processes, identifiable password fields, and targets whose accessibility identity cannot be read. Still review pasted text before you send or execute anything.

## Recording behavior

**Toggle mode:** press the configured shortcut once to start; press it again to stop. **Hold mode:** hold the configured shortcut while speaking; release it to finish. The in-app practice Start/Stop buttons are click-operated in both modes.

A non-activating, click-through overlay displays recording/processing status without taking focus from the target app. Escape cancels while a session is active, unless Windows cannot register that key. You can also cancel from the main window or tray. Recording is capped at 120 seconds and stops automatically at the cap. The MVP does not show live recognized words; it transcribes after recording stops.

Cancelling stops local recording or abandons the in-flight result, and prevents a later result from being inserted. Requests already uploaded cannot be recalled, and may still be processed/billed by the provider. A cleanup failure falls back to the original transcript with a visible warning; a transcription failure never inserts an invented result.

## AI configuration

The standard speech-to-text choices are `openai/gpt-4o-mini-transcribe` (unchanged default) and `openai/gpt-4o-transcribe`. The opt-in guided audio choice is `google/gemini-2.5-flash`. The cleanup model remains `openai/gpt-4.1-mini`. Cleanup is optional and should preserve original languages, genuine code-switching, names, numbers, negations, and tone. It removes filler and adds punctuation; it is not a writing or translation agent. LLM output is not guaranteed to be faithful—always review important content.

Standard models use `/api/v1/audio/transcriptions`; guided audio uses `/api/v1/chat/completions` with the **original WAV audio plus instructions**, not a text-only rewrite of a mistaken transcript. Cleanup also uses `/api/v1/chat/completions`. There is one recognition request per recording, plus one cleanup request when enabled. No automatic recognition retry is added. All calls use the same OpenRouter key/account, but the guided model has different audio/text token rates and can take longer. Account credits, model restrictions, and compatible-provider availability still apply. No paid live provider request was made during validation.

The language setting is Auto or a validated catalog name/code; use Auto for mixed-language speech. In standard mode it supplies the STT `language` parameter. In guided mode it supplies explicit original-language context to an instruction-capable audio model. Provider accuracy, regional connectivity, and delay need testing with your actual microphone, vocabulary, accent, and network; no accuracy or latency guarantee is made. References: [OpenRouter STT](https://openrouter.ai/docs/guides/overview/multimodal/stt), [audio inputs](https://openrouter.ai/docs/guides/overview/multimodal/audio), and [structured output](https://openrouter.ai/docs/guides/features/structured-outputs).

## Privacy and local storage

Audio is opened only after a shortcut/button or explicit microphone test. Recording samples and the encoded WAV are held in memory; the application does not intentionally write audio files to disk. Cloud transcription uploads the completed recording to OpenRouter and its upstream provider. Cleanup additionally uploads the transcript. This is **not** an offline or zero-data-retention guarantee. Provider data policies and OS-level mechanisms such as paging, crash dumps, clipboard history, or backups are outside the app's control.

Text history is **off by default**. If enabled, the most recent 50 raw/final transcripts are stored in a local SQLite database. Turning history off stops future saves; use Clear history to remove existing entries. History and preferences are not application-encrypted. The API key is stored separately in the current Windows user's Credential Manager under service `ScribeVoice.OpenRouter` and account `api-key`.

Default local data directory: `%APPDATA%\dev.scribe.voice`. Database: `scribe.sqlite3`. Test runs can override this with the `SCRIBE_VOICE_DATA_DIR` environment variable. No telemetry or startup auto-recording is implemented.

Automatic paste temporarily replaces the clipboard with the transcript. It attempts to restore a previous **plain-text** clipboard value after about 1.2 seconds, only if another app has not changed the clipboard in the meantime. Rich text/images are not preserved by this MVP. Explicit Copy intentionally leaves the result on the clipboard. Windows clipboard history and clipboard managers can retain it.

## Folder structure

```text
scribe-voice/
├── README.md                    This setup and usage guide
├── package.json                 npm scripts and frontend dependencies
├── package-lock.json            Reproducible npm dependency lock
├── index.html                   Webview entry point
├── vite.config.ts               Local dev server and frontend test config
├── tsconfig.json                Strict TypeScript checks
├── .vscode/                     Suggested extensions and tasks
├── scripts/
│   ├── Start-Desktop.ps1         Optional Windows launch/build/test helper
│   ├── desktop-dev.mjs          Auto-port selection and owned-process lifecycle
│   ├── dev-network.mjs          Port, URL/CSP and server readiness helpers
│   ├── dev-network.test.mjs     Launcher regression tests
│   ├── layout-css.test.mjs      Viewport and scroll-height regression guards
│   └── dev-server.mjs           Build-watch server with full-page live reload
├── src/
│   ├── main.tsx                 React entry point
│   ├── App.tsx                  Onboarding, practice, history, settings, overlay
│   ├── bridge.ts                Typed Tauri invoke/event boundary
│   ├── RecognitionLanguageField.tsx  Auto mode and typeable spoken-language hint
│   ├── languages.ts             Language name/code normalization
│   ├── data/                    Shared language catalog and provenance
│   ├── languages.test.ts        Catalog and ambiguity regressions
│   ├── RecognitionLanguageField.test.tsx  Hint editing and settings-save tests
│   ├── types.ts                 Shared native/UI JSON contracts
│   ├── utils.ts                 Display and status helpers
│   ├── utils.test.ts            Frontend unit tests
│   ├── layout.test.tsx          Accessible settings scroll-region test
│   └── index.css                Desktop interface styles
├── src-tauri/
│   ├── Cargo.toml               Native Rust dependencies and features
│   ├── Cargo.lock               Reproducible native dependency lock
│   ├── build.rs                 Tauri build hook
│   ├── tauri.conf.json          Windows, embedded assets, CSP, bundling
│   ├── capabilities/default.json Minimal webview permissions
│   ├── icons/                   App icon and editable source SVG
│   └── src/
│       ├── main.rs              Windows executable entry
│       ├── lib.rs               Session lifecycle, commands, shortcuts, tray
│       ├── audio.rs             Native mic worker, waveform, in-memory WAV
│       ├── ai.rs                OpenRouter calls, cleanup, credential access
│       ├── insertion.rs         Windows focus/UIA checks and controlled paste
│       ├── languages.rs         Validated canonical hints; Auto omits the API field
│       ├── language_guard.rs    English script and language-report safeguards
│       ├── model.rs             Settings, state, history types and validation
│       ├── shortcut_binding.rs  Ownership checks and rollback-safe rebinding
│       ├── single_instance.rs   Windows instance guard and legacy-copy warning
│       └── storage.rs           SQLite preferences and opt-in history
├── windows/                    Current Scribe-Voice-v0.1.4.exe and checksum
├── docs/
│   ├── ARCHITECTURE.md          Technical design and extension points
│   └── TESTING.md               Automated and manual acceptance checks
└── THIRD_PARTY_NOTICES.md        Icon license and dependency notice
```

Generated `node_modules/`, `dist/`, and `src-tauri/target/` are not source deliverables. Standard builds place executables and installer bundles under `src-tauri/target/release/`. The supplied development-profile Windows build is included in the project's `windows/` directory; the downloadable ZIP includes only the current v0.1.4 executable, not the obsolete builds.

## Tests and production builds

```powershell
npm run build
npm test
npm run test:dev-launcher
npm run test:layout
cargo test --manifest-path src-tauri/Cargo.toml --features custom-protocol
npm run desktop:build:exe
```

To reproduce the supplied development-profile executable, run `npm run desktop:build:mvp`; it appears at `src-tauri\target\debug\scribe-voice.exe`. The development device's available build storage was insufficient for a second optimized dependency cache, so the supplied artifact uses this tested development profile. For production builds, plan ample free build space; 10 GB is a practical starting allowance for toolchains, dependencies, and caches.

`npm run desktop:build:exe` creates an optimized executable without an installer at `src-tauri\target\release\scribe-voice.exe`. To create a current-user NSIS installer:

```powershell
npm run desktop:build
```

The installer appears under `src-tauri\target\release\bundle\nsis\`. NSIS build tooling may be downloaded on first use. Neither command performs public publishing or commercial code signing. If you use the workspace helper, `-Mode Test`, `-Mode Build`, and `-Mode Exe` run the corresponding checks/builds.

## Troubleshooting

**`cargo` is not recognized:** install Rust and open a new terminal, or use the workspace helper on this original device. **Linker/compiler errors:** confirm the VS C++ workload and Windows SDK are installed; use MSVC Rust. **WebView2 errors:** install the Evergreen runtime. **PowerShell blocks npm:** use `npm.cmd` in place of `npm` rather than relaxing the machine policy.

**Shortcut conflict:** quit another Scribe Voice copy or choose a different shortcut. **No microphone signal:** check the default Windows input device, hardware mute, app permissions, and exclusive-mode usage by other programs. This MVP captures the default device and supports float/16-bit input formats.

**401/402/403:** check key validity, credits, and spending/access limits. **429:** wait before trying again. **Model unavailable:** select the other transcription model. **Timeout:** shorten the recording and check connectivity. The app does not automatically retry paid transcription requests because that can create duplicate charges.

**Text does not appear:** keep the original target focused, avoid elevated apps, protected fields, and terminals, and copy the result manually. Accessibility metadata varies by app; delivery of `Ctrl+V` does not prove the app accepted the text. Focus checks reduce risk but are not an atomic OS transaction. Browser custom controls and unsupported applications may be copy-only.

**Port 1420 already in use:** use `npm run desktop:dev` or the PowerShell helper; the updated launcher selects a free port automatically and keeps Tauri's URL/CSP aligned. Do not run `npm run dev` separately first—the desktop launcher starts its own frontend. Standalone `npm run dev` still defaults to 1420 and reports a clear conflict before building. To prefer another port, set `$env:SCRIBE_VOICE_DEV_PORT='1430'` before launching; an occupied preferred port is skipped. To preview just the UI with automatic port selection, run `node scripts/desktop-dev.mjs --frontend-only`. Use Ctrl+C to stop it. **Vite/esbuild access-denied ancestor scan:** the default development script uses build-watch plus full-page reload, and build/test commands use Vite's runner config loader to avoid that issue in this workspace.

## Deliberate MVP limits

Windows is the only supported native insertion platform. There is no macOS adapter, live streaming recognition, personal dictionary, offline model, automatic updater, account sync, signed installer, context-aware app writing style, or full application compatibility certification. Audio resampling is simple linear resampling; production quality should use a band-limited resampler. Text cleanup includes basic length/truncation guards, not a semantic guarantee. These are extension points rather than hidden promises.

## If you speak English but receive Chinese or another language

In v0.1.4, open **Settings → Language & AI**, click **Use guided English recognition**, and then click **Save changes**. The preset only edits the draft; saving is necessary. It selects **English (en)** and **Gemini 2.5 Flash — guided audio**, without changing your shortcut, privacy settings, or key. Use your existing OpenRouter key; a separate Google key is not required. Start a new practice recording after saving. Changing settings does not change a recording that already started.

Guided recognition sends the original audio with explicit instructions to recognise English words as English and never translate them into Chinese or other languages. It requests a structured transcript and the model's reported input language. This is a different recognition path, not translation of an incorrect Chinese transcript. The older STT endpoint accepts but ignores ordinary text prompts, so merely adding an English sentence to that old request would not help.

Look for **Last recording recognition** in Overview. It displays the language code and model snapshotted when that recording started, not the current unsaved Settings draft. For this preset it should show English (en) and google/gemini-2.5-flash. If it shows zh, Auto, or a different model, save the intended configuration and start a new recording.

During an English session, the app blocks automatic insertion when the text is mostly in an incompatible writing system or a model language report conflicts with English. It keeps the raw transcript for explicit review and does not translate it afterward. English cleanup asks for both source and output language: a non-English source stops insertion, while a changed output language discards the cleanup and preserves the original English text. Auto and other language hints are not forced into English.

These are safeguards, not a guarantee of correct speech recognition. The script check alone cannot distinguish English from every other Latin-script language, and model language reports can be wrong, especially for short names or mixed speech. If a result is blocked, review **Raw** and the recording configuration; do not assume a Chinese result is a faithful transcript of your English audio. Guided mode may take longer and uses different token billing, with no automatic paid retries. Try a short practice phrase first, for example “Please send the meeting notes tomorrow at nine.” If it still fails, share the expected phrase and Raw result without personal details so the remaining issue can be reproduced.
