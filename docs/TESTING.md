# Testing and acceptance

## Automated checks

From the project root, run `npm run build`, `npm test`, and `cargo test --manifest-path src-tauri/Cargo.toml --features custom-protocol`. The frontend build performs strict TypeScript checks. Frontend tests cover status/level/duration/insertion display helpers. Rust tests cover safe settings defaults, reserved shortcuts, model/language validation, active phases, SQLite settings/history round trips and bounded history, audio level handling, WAV headers, resampling duration, silence guards, and conservative cleanup output guards.

These tests do not send paid requests to OpenRouter, record a user's microphone, or paste into other applications. They do not certify end-to-end accuracy or compatibility. Consult the delivery validation note for what was actually executed on the development device.

## First-run and privacy checks

Start without a key and verify that no microphone opens. Add a key inside the app (never place it in source files), restart, and verify that the UI shows availability without revealing the stored value. Delete the key and verify availability is removed. In Windows privacy settings, deny microphone access, then deliberately run the test/recording command and verify an actionable error. Restore access and run the 1.4-second microphone test. Confirm a detected signal when speaking, and that the test never calls AI.

Leave history off, complete a recording, restart, and verify the transcript was not stored in history. Enable history, complete one recording, and verify the saved entry. Disable history and verify old entries remain until explicitly cleared. Clear history with confirmation and verify the empty state. Check that no audio files were written by the app. OS clipboard history, paging, backup and provider retention are separate concerns.

## Core dictation checks with your key

Use a short sample such as “Let's meet on Tuesday, actually Wednesday, at three.” Try both cleanup off and on. Repeat with “明天四点 review 一下这个 PR。” and with names, technical terms, dates, currency, negations and numbers. Inspect raw/final text rather than assuming cleanup is correct. Compare both supported transcription models for accuracy, finish-to-result delay and actual OpenRouter usage cost.

Test insufficient credits, invalid key, unavailable network and model access. Verify that no text is inserted on transcription failure. Test cleanup failure separately and verify that raw text is preserved with a warning. Cancel while recording and while processing; verify no late result is pasted. Do not use real customer data for development acceptance tests.

## Shortcut and input checks

Use Notepad as the first external app. Click in the text area, trigger toggle mode, speak, press again, and keep focus unchanged. Verify the result or the clearly explained copy fallback. Repeat in hold mode, including a very short press/release. Repeat cancellation with Escape and the tray. Verify unrelated typing does not start recording, and that the overlay does not activate or steal focus. Test the 120-second automatic stop.

During processing, switch to a different app. Verify text is not pasted there. Change focused fields within the same browser window and verify UIA identity checks lead to a copy fallback where identity changes. Try a password field and recognized terminal application: automatic paste should be blocked. For an elevated app, expect a safe failure or copy fallback rather than requiring Scribe to run as administrator.

Test previous clipboard plain text, an image, and a clipboard manager. Plain text restoration is best-effort; images and rich formats are not preserved in this MVP. Verify an explicit Copy operation leaves the text available for manual paste. Never use a destructive shell command or a real external form submission as a test fixture.

## Lifecycle checks

Close the main window during recording: it should hide to tray and recording should continue. Reopen it and verify the live state remains correct. Quit from the tray and verify recording stops/process exits. Restart and verify saved settings are restored. Open the updated executable again and verify it attempts to reopen the existing window without registering a second active copy. Separately verify that an older running build produces the legacy-copy cleanup warning rather than another updated app.

## Manual app compatibility shortlist

Start with Notepad, a plain browser textarea, VS Code's editor (not its terminal), a chat compose field, and an email draft. Record whether UIA focus can be identified, whether paste is accepted, whether punctuation/line breaks survive, and whether copy fallback is clear. There is no claim of universal compatibility until these checks are completed on the target user's actual applications.

## Settings scrolling and window sizing

Run `npm test` for the accessible settings scroll-region regression and `npm run test:layout` for the viewport/flex-height CSS guards. In the app, open Settings at the default window size and scroll with the mouse wheel/trackpad until the API-key section and Save changes control are reachable. The top header and navigation should remain in place. Repeat with a shorter window and with an overview page containing several cards. Tab to the named content region and try Page Down/Home/End for keyboard navigation. Confirm that no key entry, microphone access, or AI call is needed to test scrolling.

Quit existing copies through their tray menus before testing a rebuilt standalone app. Closing a window with X hides it to tray rather than releasing its global shortcut.

## Shortcut and duplicate-instance checks (retained in v0.1.3)

Quit earlier copies through their tray menus and stop development sessions with Ctrl+C. Open only `windows/Scribe-Voice-v0.1.3.exe`. Confirm the sidebar reports v0.1.3 and that opening this updated executable again attempts to reopen the existing window instead of creating a second active Scribe app.

If a saved shortcut is genuinely unavailable, select another combination and save. A successful save should name the active combination and remove only the stale shortcut registration error from Overview; it should not clear an unrelated AI/microphone failure or erase edited transcript text. Save the same working shortcut again and verify no duplicate-registration error appears. Attempt an unavailable candidate and verify the previously saved binding remains selected in the backend and the save is rejected rather than reporting success.

The Windows guard and binding-rollback unit tests do not require microphone access or provider credentials. A real dictation test remains a deliberate user action after registration is confirmed; do not trigger recording just to inspect startup or settings.

## Recognition-language hints (v0.1.2 feature, retained in v0.1.3)

Quit the earlier app via its tray menu, open `windows/Scribe-Voice-v0.1.3.exe`, and verify v0.1.3. Existing Auto/en/zh preferences should remain valid. Fresh preferences default to Auto. No recording should start when opening Settings or changing language mode.

Choose Hint the spoken language and type Japanese, 日本語, or ja. Confirm the status displays API hint ja, save, then reopen Settings/restart the app and verify the saved hint is displayed as Japanese. Repeat with Tamil/ta or another language that your provider supports. The catalog validates names/codes; it is not a model support benchmark.

Type an unknown name, an incomplete name, or a region tag such as ja-JP. Save should be disabled with inline feedback. Switch to Auto-detect: the input disappears and the saved language becomes auto. Toggle modes before saving and confirm the last typed hint can be recovered. No API key, microphone capture, or provider call is required for these UI checks.

Run `npm test`, `npm run test:dev-launcher`, `npm run test:layout`, and `cargo test --manifest-path src-tauri/Cargo.toml --features custom-protocol`. The native wire test binds only localhost, uses synthetic bytes, and never calls OpenRouter. It verifies Auto omits the multipart language field and Japanese sends ja.

For actual accuracy acceptance, deliberately dictate the same sample in Auto and with the correct spoken-language hint, then compare names, punctuation, and mixed-language text. These are real paid transcription requests if you choose to perform them. Do not request translation; the app should preserve the language spoken. Do not claim higher accuracy from the code/catalog tests alone.

## Version 0.1.3: name-prefix search regression

Quit the old app via its tray, launch `windows/Scribe-Voice-v0.1.3.exe`, and verify v0.1.3. In manual hint mode, clear the hint and type `c`, then `h`. The field must show `ch`, not Chamorro, and the list must include Chinese (`zh`) as well as Chamorro (`ch`). Continue typing `i`: the field must show `chi` and Chamorro should no longer match. Select Chinese and save; the hint must be `zh`, not `ch`.

Repeat with `ta` then `tag`; the input must not expand to Tamil and the Tagalog alias should offer Filipino (`tl`). Try a native prefix such as 日本 and a code such as zh. Check ArrowDown/ArrowUp plus Enter, Escape closing the list without changing text, mouse selection without blur losing the click, and disabled preview controls. No microphone, key, or provider request is needed.

A complete recognized code such as `ch` still means Chamorro when deliberately entered/saved as a code. The repair makes Chinese discoverable and allows the name to be completed; it does not redefine ISO codes or silently change an earlier saved preference.

## Version 0.1.4: guided English recognition

Quit earlier copies and open `windows/Scribe-Voice-v0.1.4.exe`. Confirm v0.1.4, open Settings, click **Use guided English recognition**, verify English (en) and Gemini 2.5 Flash — guided audio, then **Save changes**. The preset must not save or record automatically. Shortcut, privacy preferences and the key should not change. Native permissions and model billing still apply; this is a different model under the same OpenRouter account.

Start a new deliberate practice recording: “Please send the meeting notes tomorrow at nine.” In Overview, **Last recording recognition** must show the saved `en` and `google/gemini-2.5-flash` snapshot, even if you later edit an unsaved draft. Inspect Raw before judging cleanup. Confirm English remains English, and that practice does not auto-paste. Repeat with cleanup off to isolate recognition. A genuine live accuracy claim requires these microphone/provider tests; the automated fixtures use synthetic bytes and model-shaped mock responses, not real speech.

Simulated native tests cover wrong Chinese/Cyrillic/Arabic script for an English session, a guided French report despite Latin characters, no-speech/malformed/truncated guided results, English cleanup turning into Spanish, and a French source that must stop rather than fall back and paste. Inspect the controller ordering: Raw preservation precedes the guard, and both recognition/source-language guards precede insertion. No automatic recognition retry or translation is allowed.

Use Auto for deliberate mixed-language speech. Brief proper names and very short utterances can be ambiguous; a blocked result should remain available to review manually. Script and model language checks are heuristics, not an accuracy guarantee. For remaining failures, record the expected phrase, Raw text, used snapshot language/model, and whether cleanup changed it; avoid sharing personal dictation unnecessarily.
