# Delivery validation — 31 October 2026

The source was built and checked on the selected Windows device with Node 24.14.0, npm 11.9.0, a workspace-local MSVC Rust 1.99.1 toolchain, Visual Studio 2022 C++ tools, and WebView2 installed. No machine-wide Rust installation or PATH change was made.

`npm run build` passed strict TypeScript checking and produced a production webview bundle. `npm test` passed all four frontend helper tests. `cargo test --manifest-path src-tauri/Cargo.toml --features custom-protocol` passed all ten native tests on the final source. `cargo fmt --check` passed. The project configurations and PowerShell launcher were syntax-checked.

`npm run desktop:build:mvp` successfully produced a 64-bit Windows executable with the embedded frontend. It uses the development profile and has no commercial code signature. An optimized release attempt ran out of the device's available build storage during dependency compilation; only that failed generated release cache was removed. Use the documented release command on a machine with sufficient free build space.

The loopback development server was verified to serve the app. Browser preview displayed the actual onboarding/practice interface, marked itself as browser-only, and disabled native recording, microphone, clipboard and credential actions rather than simulating success.

The native executable was launched for a bounded smoke test. A Scribe Voice main window was detected. Native setup/render readiness is recorded separately below after the smoke test. The test does not open the microphone, call OpenRouter, store a real API key, or paste into another application.

**Still requiring your acceptance test:** actual microphone capture and permission UX; live OpenRouter model access, account credits, transcription/cleanup quality and latency; global key press/release behavior on your keyboard; insertion compatibility in your actual applications; cancellation during paid requests; and clipboard interaction with installed managers. The ten native tests are unit tests, not proof of universal cross-app input reliability. Start with the in-app practice mode and Notepad using non-sensitive text.

## Native startup result

The final standalone build explicitly enables Tauri's `custom-protocol` feature and embeds the frontend; the preview server was stopped during the last launch check. A native window was created, but the automated run did **not** complete initialization within the 45-second readiness window. The opt-in startup trace reached `run entered` and did not reach the app's `setup entered` callback. No database was created for that test. Startup stderr contained no explanatory error. The underlying cause has not been established; this is not a passed desktop end-to-end test.

Try launching the supplied test executable directly from Windows Explorer in your normal desktop session. Confirm that onboarding appears before entering a key or using real dictation. If it remains blank or does not open, treat startup as a blocker and report it for the next iteration rather than assuming the app is ready. No claim of successful live transcription or reliable cross-app insertion is made by this delivery.

The supplied `scripts/Start-Desktop.ps1 -Mode Test` helper was also executed successfully against the final source with the workspace-local toolchain. It completed the frontend build, all four frontend tests, and all ten native tests. The helper's development mode starts the documented build-watch server; the unresolved native initialization boundary described above still applies.

## Development port-conflict fix — 31 October 2026

The delivered development launcher was updated after a reported `EADDRINUSE` failure on `127.0.0.1:1420`. `desktop:dev` now uses an owned-process wrapper that selects a free port, starts one frontend server, checks its token/project-specific readiness, and passes matching dev URL/CSP overrides to Tauri with `beforeDevCommand: null`. It leaves an existing listener alone and cleans up its own frontend when the desktop command exits.

All five new `npm run test:dev-launcher` regression tests passed. The existing four frontend tests were rerun and passed. The installed Tauri CLI schema explicitly accepts null for `beforeDevCommand`, and its help confirms support for inline JSON configuration overrides.

A bounded frontend-only integration test was performed with the actual port-1420 conflict present. The launcher selected 1421, served the built UI successfully, and released 1421 on controlled shutdown. Port 1420 remained occupied before and after, confirming the existing listener was not stopped. The test made no provider requests and did not launch the native app. This fixes the reported development-server port collision; it does not by itself resolve or validate the separate native WebView initialization caveat above.

## Scrolling fix and manual startup confirmation — 31 October 2026

The user's screenshot confirms the native Settings screen renders in the normal Windows desktop session. This supersedes any suggestion that native UI startup is universally blocked; the earlier automated-run initialization failure remains an automated-test limitation, not a proven end-user startup failure. Live microphone/transcription/insertion acceptance remains unverified.

The scrolling bug came from a growing `min-height: 100vh` app shell/workspace combined with `body { overflow: hidden }` and no shrinkable height for the flex content pane. The fix bounds the root/shell/workspace to the viewport, sets the content pane's `min-height: 0` and `overflow: auto`, and keeps the header/sidebar independent of page scrolling. The content region is focusable for keyboard navigation, and narrow layouts now stack settings cards. Error notices are also matched case-insensitively so `Error:` messages no longer appear as green success notices.

Five frontend tests (including the new accessible scroll-region test) and two direct CSS regression tests passed. The TypeScript/production frontend build passed. The updated embedded Windows executable was successfully rebuilt using `cargo build --features custom-protocol` after the frontend build.

A real browser wheel gesture was exercised on the rebuilt Settings UI, not just a simulated DOM change: the scroll position advanced from 0 to 702 pixels, the content pane stayed within the viewport with its top at 120 pixels, and the API-key card became fully visible (bottom approximately 839 pixels in a 900-pixel viewport). No microphone or AI request was used in this check.

The new executable is `windows/Scribe-Voice-ScrollFix.exe`; its copy was verified by SHA256. The existing running executable and development app were not stopped or overwritten. Quit existing instances before opening the new build, to avoid competing global shortcuts.

## Shortcut reliability repair — version 0.1.1

Investigation found five Scribe processes in the desktop session: the original executable, a development executable, and three ScrollFix copies. The error referred to Ctrl+Shift+G while the screenshot showed Ctrl+Shift+T saved. Code inspection confirmed that successful settings saves updated the binding but did not clear a previous startup registration error in voice state.

Version 0.1.1 now tracks shortcut errors separately and emits recovered voice state after a successful save. It preserves transcript text and unrelated AI/microphone errors. A settings save confirms which shortcut is active. Rebinding reuses an already-owned combination, rejects an unavailable candidate without releasing the previous key, and rolls back a failed persistence operation. Registration no longer occurs while holding the controller mutex. Startup errors no longer dump internal HotKey structures.

A named Windows instance guard prevents a second updated app from registering another copy and attempts to show the existing main window. Legacy builds are detected by their existing window and require one-time tray Quit/development-session cleanup; their warning dialog does not hold the instance lock. No process was deliberately terminated by this repair while the cleanup confirmation remained pending.

Final source verification passed **20 native tests**, including six binding-transaction regressions, three stale-error/transcript-preservation regressions, and a real Windows named-mutex lifecycle check. The existing native audio/storage/validation/cleanup guards passed too. The production frontend build and **12 frontend/launcher/layout tests** also passed. Both package manifests, lockfiles, Tauri configuration, and the UI version label now identify 0.1.1. The repaired embedded executable `windows/Scribe-Voice-ShortcutFix.exe` was rebuilt and its delivery copy verified by SHA256.

The binding transaction tests use a deterministic registry fixture; they do not simulate user speech or claim paid dictation/end-to-end insertion acceptance. Full GUI confirmation of the selected shortcut should be done after legacy copies are closed. No deliberate microphone recording or paid AI request was performed by these checks. The app identifier and credential/storage locations are unchanged.

## Recognition-language hints — version 0.1.2

Added explicit Auto-detect versus manual spoken-language hint controls. Users can type a recognized English/native name, alias, or two-letter ISO-639-1 code. React and Rust share a catalog of 183 standard codes. Canonical names and codes have priority; ambiguous ICU/platform aliases are pruned and duplicate display names fall back to their official names. The tests caught and fixed the Akan/Twi locale alias collision instead of suppressing the assertion.

Auto-detect omits the `language` multipart field. A selected hint sends only a validated canonical code. A bounded real localhost HTTP wire check used synthetic bytes and no credentials to verify that Auto has no language part and Japanese sends `ja`, not `Japanese`. Invalid hints are rejected before request construction. This did not use a microphone or contact OpenRouter.

The final production frontend build passed. **19 frontend tests**, **5 launcher tests**, **2 layout tests**, and **27 native tests** passed: **53 total**. Coverage includes name/code/native-name normalization, ambiguous-name handling, invalid-input save blocking, hint/Auto toggling, saved-code display, old Auto/en/zh preference compatibility, new ja/ta/es preference persistence, multipart request behavior, and the earlier shortcut/single-instance protections. The native executable was rebuilt with the final frontend embedded.

No translation option or translation request was added, and the conservative cleanup prompt still says not to translate. A valid code does not establish that the chosen provider/model supports that language or dialect equally well. Real recognition-quality comparisons require deliberate speech samples; no improvement percentage is claimed.

The app identifier and credential locations are unchanged. The running v0.1.1 ShortcutFix app was not stopped or overwritten; the inactive canonical `windows/Scribe-Voice.exe` is updated to v0.1.2 with a verified delivery hash. Quit the current app via its tray menu before opening the update, or the shared instance guard will reopen the earlier version.

## Language suggestion search repair — version 0.1.3

The reported `ch` bug was reproduced in code: `languageInputValue` expanded the controlled input value `ch` into the valid ISO code's label Chamorro on every render. That conversion replaced a still-in-progress search query and caused the native datalist to narrow to Chamorro. The formatting helper is now used only for saved/external values; the live query is separate state.

Replaced the browser-native datalist with a controlled accessible combobox. Suggestions search friendly names, ISO codes, and English/native aliases, with case-insensitive and accent-insensitive search. Explicit selection still commits the canonical code. Arrow keys/Enter selection, Escape dismissal, raw-prefix preservation, and disabled controls are covered. API normalization, Auto omission, and no-translation behavior are unchanged.

All **61 automated tests** passed: **27 frontend**, **5 launcher**, **2 layout**, and **27 native**. New regressions cover `ch` including Chinese/Chamorro, `chi` excluding Chamorro, typing Chinese through the valid `ch` code prefix, selecting Chinese and saving `zh`, keyboard selection, and `ta` continuing to Tagalog instead of expanding to Tamil.

A real connected-browser check used the exact production component and stylesheet in an explicitly UI-only fixture. Entering `ch` left the input value `ch` and showed Chinese (`zh`) alongside Chamorro (`ch`). A native browser text-input action appended `i`, producing `chi` and removing Chamorro from the list. Clicking Chinese displayed Chinese and the application-updated preference/status both reported `zh`. This verifies real rendering and input acceptance, not paid transcription or the installed native app's entire end-to-end pipeline. The fixture uses no native commands, microphone, or provider requests. Its build initially hit parent-directory permission errors in direct esbuild resolution; the existing Vite/Rollup route recovered the check without changing device permissions.

The v0.1.3 embedded executable was rebuilt and copied/hash-verified as `windows/Scribe-Voice-v0.1.3.exe`. The running v0.1.2 `Scribe-Voice.exe` was left unchanged. Quit it via the tray before opening the update and verify the sidebar version. Existing preferences and credentials retain their locations; previously saved `ch` still legitimately means Chamorro, so explicitly select Chinese (`zh`) to change that hint.

## Guided English recognition and language safeguards — version 0.1.4

User-reported symptom: spoken English returns Chinese or another language. No actual failed audio sample was supplied, so the original recognition error has not been reproduced on a live provider. Inspection confirmed the previous standard route sends the selected canonical language; it did not establish which language was used in the user's failed recording. Access to the user's external preference directory was denied, and no permission bypass, key retrieval, history reading, or actual preference modification was used for diagnosis.

Added an opt-in original-audio guided route using `google/gemini-2.5-flash` on OpenRouter audio chat with explicit faithful-transcription/no-translation language instructions and a structured input-language report. Current documented endpoint metadata confirms audio input and structured-output support. Existing STT models/defaults remain available and unchanged. The English preset changes only the Settings draft, and requires Save. It does not translate mistaken text, automatically retry a paid recognition request, or change any saved key.

English sessions now check raw script proportions and available model language reports before cleanup/insertion. Raw is preserved for review if mismatched. English cleanup reports source/output language in its existing request: a non-English source stops insertion, while a translated cleanup output preserves the original English raw text. These are heuristic/model-based checks, not guaranteed independent language detection; script alone cannot distinguish every Latin-script language, and standard STT with cleanup disabled has less language verification than guided mode.

All **81 automated tests passed**: **32 frontend**, **42 native**, **5 launcher**, and **2 scrolling CSS**. Native fixtures verify canonical English multipart fields; original WAV bytes in the guided chat request; no second recognition/retry request; structured-result, no-speech, and truncation handling; Chinese and conflicting Latin-language reports; cleanup translation to Spanish; and a non-English source that must stop rather than fall back and paste. The first native test attempt failed three local HTTP fixtures because loopback socket access was denied; rerunning with the specific network access for local synthetic fixtures passed. No paid API/provider request or microphone recording was made.

A real connected-browser check rendered the exact SettingsView with all native callbacks mocked. The preset changed the displayed language to English, selected the guided model, and enabled Save without committing. Mock Save then produced canonical `en` plus `google/gemini-2.5-flash`, preserved shortcut/activation/cleanup/privacy settings, and disabled Save again. An off-screen native click had no effect; the grounded semantic button locator with automatic scrolling completed the check. This validates UI interaction, not installed native speech accuracy or actual preference persistence.

The final frontend bundle and embedded native executable built successfully. `windows/Scribe-Voice-v0.1.4.exe` was copied and SHA256-verified under a new name (19,702,784 bytes), leaving the running v0.1.3 app untouched. Native speech quality still needs a deliberate user practice recording with English selected/saved and the guided model enabled; verify the Last recording recognition snapshot and inspect Raw. The updated README describes this acceptance step and provider/model billing limits.
