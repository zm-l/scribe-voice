mod ai;
mod audio;
mod insertion;
mod language_guard;
mod languages;
mod model;
mod shortcut_binding;
mod single_instance;
mod storage;

use model::{ActivationMode, Bootstrap, HistoryEntry, Settings, VoiceState};
use std::{
    str::FromStr,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

struct Cancellation {
    cancelled: AtomicBool,
    notify: tokio::sync::Notify,
}
impl Cancellation {
    fn new() -> Self {
        Self {
            cancelled: AtomicBool::new(false),
            notify: tokio::sync::Notify::new(),
        }
    }
    fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        self.notify.notify_one();
    }
    fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}
#[derive(Clone)]
struct Session {
    id: u64,
    target: Option<insertion::Target>,
    settings: Settings,
    cancellation: Arc<Cancellation>,
}
struct Inner {
    settings: Settings,
    voice: VoiceState,
    session: Option<Session>,
    probe: bool,
    settings_update: bool,
    shortcut_error: Option<String>,
}
struct AppState {
    inner: Mutex<Inner>,
    storage: Mutex<storage::Storage>,
    settings_lock: Mutex<()>,
    audio: audio::AudioService,
    client: reqwest::Client,
}

fn emit(app: &tauri::AppHandle, state: &VoiceState) {
    let _ = app.emit("voice-state", state);
}
fn show_overlay(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("overlay") {
        if let Ok(Some(monitor)) = app.primary_monitor() {
            let factor = monitor.scale_factor();
            let size = monitor.size();
            let origin = monitor.position();
            let width = (360.0 * factor) as i32;
            let x = origin.x + (size.width as i32 - width) / 2;
            let y = origin.y + size.height as i32 - (120.0 * factor) as i32;
            let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
        }
        let _ = window.show();
    }
}
fn finish_ui(app: &tauri::AppHandle) {
    let _ = app
        .global_shortcut()
        .unregister(Shortcut::from_str("Escape").unwrap());
    let a = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(3)).await;
        let state = a.state::<AppState>();
        if !state.inner.lock().unwrap().voice.busy() {
            if let Some(w) = a.get_webview_window("overlay") {
                let _ = w.hide();
            }
        }
    });
}
fn error_state(app: &tauri::AppHandle, message: String) {
    let state = app.state::<AppState>();
    let mut inner = state.inner.lock().unwrap();
    if inner.voice.busy() {
        return;
    }
    inner.voice.phase = "error".into();
    inner.voice.message = message;
    emit(app, &inner.voice);
}
fn set_phase(
    app: &tauri::AppHandle,
    id: u64,
    phase: &str,
    message: &str,
    raw: Option<&str>,
) -> bool {
    let state = app.state::<AppState>();
    let mut inner = state.inner.lock().unwrap();
    if inner
        .session
        .as_ref()
        .is_none_or(|s| s.id != id || s.cancellation.is_cancelled())
    {
        return false;
    }
    inner.voice.phase = phase.into();
    inner.voice.message = message.into();
    if let Some(text) = raw {
        inner.voice.raw_text = text.into();
        inner.voice.text = text.into();
    }
    emit(app, &inner.voice);
    true
}

fn start_session(app: tauri::AppHandle, global: bool) -> Result<(), String> {
    let state = app.state::<AppState>();
    let mut inner = state.inner.lock().unwrap();
    if inner.voice.busy() || inner.probe || inner.settings_update {
        return Err("A recording, AI request, or microphone test is already active.".into());
    }
    ai::api_key()?;
    let id = inner.voice.session_id + 1;
    let target = if global { insertion::capture() } else { None };
    let session = Session {
        id,
        target: target.clone(),
        settings: inner.settings.clone(),
        cancellation: Arc::new(Cancellation::new()),
    };
    inner.voice = VoiceState {
        phase: "starting".into(),
        session_id: id,
        message: "Opening microphone…".into(),
        language_hint: session.settings.language.clone(),
        transcription_model: session.settings.transcription_model.clone(),
        target_app: target.map(|t| t.app).unwrap_or_else(|| {
            if global {
                "Unknown target".into()
            } else {
                "Practice mode".into()
            }
        }),
        ..Default::default()
    };
    inner.session = Some(session);
    emit(&app, &inner.voice);
    // Serialize native start/stop/cancel commands under this short-lived lock so a late start cannot reopen a cancelled session.
    if let Err(error) = state.audio.start() {
        inner.session = None;
        inner.voice.phase = "error".into();
        inner.voice.message = error.clone();
        emit(&app, &inner.voice);
        return Err(error);
    }
    inner.voice.phase = "recording".into();
    inner.voice.message = "Listening. Use your shortcut to finish, or Escape to cancel.".into();
    if app
        .global_shortcut()
        .register(Shortcut::from_str("Escape").unwrap())
        .is_err()
    {
        inner.voice.message =
            "Listening. Escape is unavailable; cancel from the app if needed.".into();
    }
    emit(&app, &inner.voice);
    drop(inner);
    show_overlay(&app);
    Ok(())
}

pub(crate) async fn stop_session(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    let (session, captured) = {
        let mut inner = state.inner.lock().unwrap();
        if inner.voice.phase != "recording" {
            return Ok(());
        }
        let session = inner
            .session
            .clone()
            .ok_or_else(|| "No session is active.".to_string())?;
        let captured = state.audio.stop();
        inner.voice.phase = "transcribing".into();
        inner.voice.level = 0.0;
        inner.voice.message = "Recording stopped. Transcribing with OpenRouter…".into();
        if let Ok(ref audio) = captured {
            inner.voice.duration_ms = audio.samples.len() as u64 * 1000 / audio.sample_rate as u64;
        }
        emit(&app, &inner.voice);
        (session, captured)
    };
    let wav = match captured.and_then(|audio| audio::encode_wav(&audio)) {
        Ok(wav) => wav,
        Err(e) => {
            complete_error(&app, &session, e);
            return Ok(());
        }
    };
    let key = match ai::api_key() {
        Ok(key) => key,
        Err(e) => {
            complete_error(&app, &session, e);
            return Ok(());
        }
    };
    if session.cancellation.is_cancelled() {
        return Ok(());
    }
    let recognized = tokio::select! {
        _=session.cancellation.notify.notified()=>return Ok(()),
        result=ai::transcribe(&state.client,&key,wav,&session.settings)=>match result{Ok(t)=>t,Err(e)=>{complete_error(&app,&session,e);return Ok(());}}
    };
    let raw = recognized.text;
    if !set_phase(
        &app,
        session.id,
        "transcribing",
        "Transcript received.",
        Some(&raw),
    ) {
        return Ok(());
    }
    if let Err(reason) = language_guard::check(
        &raw,
        &session.settings,
        recognized.reported_language.as_deref(),
    ) {
        // set_phase already preserved Raw for explicit review; never paste or translate this result.
        complete_error(&app, &session, reason);
        return Ok(());
    }
    let mut warning = String::new();
    let text = if session.settings.cleanup_enabled {
        if !set_phase(
            &app,
            session.id,
            "cleaning",
            "Lightly cleaning your transcript…",
            None,
        ) {
            return Ok(());
        }
        if session.cancellation.is_cancelled() {
            return Ok(());
        }
        tokio::select! {
            _=session.cancellation.notify.notified()=>return Ok(()),
            result=ai::cleanup(&state.client,&key,&raw,&session.settings)=>match result{
                Ok(ai::CleanupResult::Edited(t))=>t,
                Ok(ai::CleanupResult::SourceLanguageMismatch(reason))=>{complete_error(&app,&session,reason);return Ok(());},
                Err(e)=>{warning=format!(" Cleanup unavailable: {e} Using the original transcript.");raw.clone()}
            }
        }
    } else {
        raw.clone()
    };
    if session.cancellation.is_cancelled() {
        return Ok(());
    }
    // Hold the controller lock across the brief paste decision: cancellation and focus are rechecked before input is emitted.
    let mut inner = state.inner.lock().unwrap();
    if inner
        .session
        .as_ref()
        .is_none_or(|s| s.id != session.id || s.cancellation.is_cancelled())
    {
        return Ok(());
    }
    inner.voice.raw_text = raw;
    inner.voice.text = text.clone();
    inner.voice.phase = "done".into();
    inner.voice.level = 0.0;
    if let Some(ref target) = session.target {
        match insertion::paste(target, &text) {
            Ok(()) => {
                inner.voice.insertion = "pasted".into();
                inner.voice.message="Paste sent to the original app. Check the field; if it did not appear, copy the result here.".into();
            }
            Err(reason) => {
                inner.voice.insertion = "copy_required".into();
                inner.voice.message = reason;
            }
        }
    } else {
        inner.voice.insertion = "preview".into();
        inner.voice.message = "Practice complete. Review or edit the result, then copy it.".into();
    }
    inner.voice.message.push_str(&warning);
    if session.settings.save_history && inner.settings.save_history {
        if let Err(e) = state
            .storage
            .lock()
            .unwrap()
            .add_history(&inner.voice, &session.settings.transcription_model)
        {
            inner
                .voice
                .message
                .push_str(&format!(" History could not be saved: {e}"));
        }
    }
    inner.session = None;
    emit(&app, &inner.voice);
    drop(inner);
    finish_ui(&app);
    Ok(())
}
fn complete_error(app: &tauri::AppHandle, session: &Session, error: String) {
    let state = app.state::<AppState>();
    let mut inner = state.inner.lock().unwrap();
    if inner
        .session
        .as_ref()
        .is_none_or(|s| s.id != session.id || s.cancellation.is_cancelled())
    {
        return;
    }
    inner.voice.phase = "error".into();
    inner.voice.message = error;
    inner.voice.level = 0.0;
    inner.session = None;
    emit(app, &inner.voice);
    drop(inner);
    finish_ui(app);
}
fn cancel_session(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    let mut inner = state.inner.lock().unwrap();
    if let Some(session) = inner.session.take() {
        session.cancellation.cancel();
        state.audio.cancel();
        inner.voice.phase = "cancelled".into();
        inner.voice.message =
            "Cancelled. No text was inserted. Requests already uploaded cannot be recalled.".into();
        inner.voice.level = 0.0;
        emit(app, &inner.voice);
        drop(inner);
        finish_ui(app);
    }
}
pub(crate) async fn microphone_failed(app: tauri::AppHandle, error: String) {
    let session = {
        let state = app.state::<AppState>();
        let inner = state.inner.lock().unwrap();
        if inner.voice.phase != "recording" {
            return;
        }
        inner.session.clone()
    };
    if let Some(session) = session {
        let state = app.state::<AppState>();
        state.audio.cancel();
        complete_error(&app, &session, error);
    }
}

#[tauri::command]
fn get_bootstrap(app: tauri::AppHandle) -> Bootstrap {
    let state = app.state::<AppState>();
    let inner = state.inner.lock().unwrap();
    Bootstrap {
        settings: inner.settings.clone(),
        state: inner.voice.clone(),
        has_api_key: ai::api_key().is_ok(),
        platform: if cfg!(windows) {
            "windows"
        } else {
            "unsupported"
        },
        version: env!("CARGO_PKG_VERSION"),
    }
}
#[tauri::command]
async fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<Settings, String> {
    tauri::async_runtime::spawn_blocking(move || save_settings_inner(&app, settings))
        .await
        .map_err(|e| format!("Settings update failed: {e}"))?
}
fn save_settings_inner(app: &tauri::AppHandle, mut settings: Settings) -> Result<Settings, String> {
    settings.shortcut = settings.shortcut.trim().to_string();
    settings.language = languages::normalize(&settings.language)?;
    settings.validate()?;
    let shortcut = Shortcut::from_str(&settings.shortcut)
        .map_err(|_| "Invalid shortcut. Try Ctrl+Shift+Space or Ctrl+Alt+D.".to_string())?;
    let state = app.state::<AppState>();
    let _gate = state.settings_lock.lock().unwrap();
    let previous_settings = {
        let mut inner = state.inner.lock().unwrap();
        if inner.voice.busy() || inner.probe || inner.settings_update {
            return Err("Finish or cancel the current session before changing settings.".into());
        }
        inner.settings_update = true;
        inner.settings.clone()
    };
    let previous = Shortcut::from_str(&previous_settings.shortcut).ok();
    // Registration dispatches to the main thread; never hold the controller lock here.
    let result = shortcut_binding::rebind(app.global_shortcut(), previous, shortcut, || {
        state.storage.lock().unwrap().save_settings(&settings)
    });
    let previous_active = previous.is_some_and(|old| app.global_shortcut().is_registered(old));
    let mut inner = state.inner.lock().unwrap();
    inner.settings_update = false;
    match result {
        Ok(()) => {
            inner.settings = settings.clone();
            let previous_error = inner.shortcut_error.take();
            inner
                .voice
                .recover_shortcut(previous_error.as_deref(), &settings.shortcut);
            if inner.voice.phase == "idle" {
                inner.voice.message = format!("Ready. {} is active.", settings.shortcut);
            }
            let voice = inner.voice.clone();
            drop(inner);
            emit(app, &voice);
            Ok(settings)
        }
        Err(error) => {
            if !previous_active {
                let message = format!(
                    "Shortcut {} is not active. {error} Choose another combination in Settings.",
                    previous_settings.shortcut
                );
                inner.shortcut_error = Some(message.clone());
                inner.voice.phase = "error".into();
                inner.voice.message = message;
                emit(app, &inner.voice);
            }
            Err(format!("Could not activate {}. {error}", settings.shortcut))
        }
    }
}
#[tauri::command]
fn set_api_key(key: String) -> Result<bool, String> {
    let key = key.trim();
    if key.is_empty() || key.len() > 512 {
        return Err("Enter a valid OpenRouter API key.".into());
    }
    ai::credential()?
        .set_password(key)
        .map_err(|e| format!("Could not save key in Windows Credential Manager: {e}"))?;
    Ok(true)
}
#[tauri::command]
fn delete_api_key() -> Result<(), String> {
    match ai::credential()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not delete stored key: {e}")),
    }
}
#[tauri::command]
async fn probe_microphone(app: tauri::AppHandle) -> Result<audio::MicrophoneProbe, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        {
            let mut inner = state.inner.lock().unwrap();
            if inner.voice.busy() || inner.probe || inner.settings_update {
                return Err("Finish the current recording or microphone test first.".into());
            }
            inner.probe = true;
        }
        let result = (|| {
            state.audio.start()?;
            std::thread::sleep(Duration::from_millis(1400));
            let audio = state.audio.stop()?;
            let peak = audio::rms_level(&audio.samples);
            Ok(audio::MicrophoneProbe {
                device_name: audio.device_name,
                peak_level: peak,
                detected_audio: peak > 0.01,
            })
        })();
        state.inner.lock().unwrap().probe = false;
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn open_microphone_settings() -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer.exe")
            .arg("ms-settings:privacy-microphone")
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("This MVP supports Windows only.".into())
    }
}
#[tauri::command]
async fn start_recording(app: tauri::AppHandle) -> Result<(), String> {
    let a = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || start_session(a, false))
        .await
        .map_err(|e| e.to_string())?;
    if let Err(ref error) = result {
        error_state(&app, error.clone());
    }
    result
}
#[tauri::command]
async fn stop_recording(app: tauri::AppHandle) -> Result<(), String> {
    stop_session(app).await
}
#[tauri::command]
fn cancel_recording(app: tauri::AppHandle) {
    cancel_session(&app);
}
#[tauri::command]
fn copy_text(text: String) -> Result<(), String> {
    if text.len() > 100_000 {
        return Err("Text is too large for this MVP.".into());
    }
    insertion::copy(&text)
}
#[tauri::command]
fn list_history(app: tauri::AppHandle) -> Result<Vec<HistoryEntry>, String> {
    app.state::<AppState>().storage.lock().unwrap().history()
}
#[tauri::command]
fn clear_history(app: tauri::AppHandle) -> Result<(), String> {
    app.state::<AppState>().storage.lock().unwrap().clear()
}
#[tauri::command]
fn hide_window(app: tauri::AppHandle) -> Result<(), String> {
    app.get_webview_window("main")
        .ok_or_else(|| "Window not available".to_string())?
        .hide()
        .map_err(|e| e.to_string())
}

fn shortcut_event(
    app: &tauri::AppHandle,
    shortcut: &Shortcut,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    if *shortcut == Shortcut::from_str("Escape").unwrap() {
        if event.state == ShortcutState::Pressed {
            cancel_session(app);
        }
        return;
    }
    let (mode, phase, matches) = {
        let state = app.state::<AppState>();
        let inner = state.inner.lock().unwrap();
        if inner.settings_update {
            return;
        }
        (
            inner.settings.activation_mode.clone(),
            inner.voice.phase.clone(),
            Shortcut::from_str(&inner.settings.shortcut).ok().as_ref() == Some(shortcut),
        )
    };
    if !matches {
        return;
    }
    let should_stop = match mode {
        ActivationMode::Toggle => event.state == ShortcutState::Pressed && phase == "recording",
        ActivationMode::Hold => event.state == ShortcutState::Released && phase == "recording",
    };
    if should_stop {
        let a = app.clone();
        tauri::async_runtime::spawn(async move {
            let _ = stop_session(a).await;
        });
        return;
    }
    // Reserve and start synchronously in hotkey event order. A fast release is then handled after startup, not lost before an async task is scheduled.
    if event.state == ShortcutState::Pressed
        && !matches!(
            phase.as_str(),
            "starting" | "recording" | "transcribing" | "cleaning"
        )
    {
        if let Err(e) = start_session(app.clone(), true) {
            error_state(app, e);
        }
    }
}

fn startup_trace(stage: &str) {
    if let Some(dir) = std::env::var_os("SCRIBE_VOICE_DATA_DIR") {
        use std::io::Write;
        let dir = std::path::PathBuf::from(dir);
        let _ = std::fs::create_dir_all(&dir);
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("startup.log"))
        {
            let _ = writeln!(file, "{}: {stage}", chrono::Utc::now().to_rfc3339());
        }
    }
}

pub fn run() {
    startup_trace("run entered");
    let _instance = match single_instance::enter() {
        Ok(Some(guard)) => guard,
        Ok(None) => return,
        Err(error) => {
            single_instance::show_error(&error);
            return;
        }
    };
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(shortcut_event)
                .build(),
        )
        .setup(|app| {
            startup_trace("setup entered");
            let data = std::env::var_os("SCRIBE_VOICE_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            std::fs::create_dir_all(&data)?;
            let storage = storage::Storage::open(&data.join("scribe.sqlite3"))
                .map_err(std::io::Error::other)?;
            startup_trace("database opened");
            let settings = storage.settings();
            let shortcut = settings.shortcut.clone();
            app.manage(AppState {
                inner: Mutex::new(Inner {
                    settings,
                    voice: VoiceState::default(),
                    session: None,
                    probe: false,
                    settings_update: false,
                    shortcut_error: None,
                }),
                storage: Mutex::new(storage),
                settings_lock: Mutex::new(()),
                audio: audio::AudioService::new(app.handle().clone()),
                client: ai::client().map_err(std::io::Error::other)?,
            });
            // Publish state before registration so an early shortcut event cannot access missing state.
            if app.global_shortcut().register(shortcut.as_str()).is_err() {
                let message = format!("Shortcut {shortcut} could not be registered. Another app may be using it. Choose another combination in Settings.");
                let state = app.state::<AppState>();
                let mut inner = state.inner.lock().unwrap();
                inner.shortcut_error = Some(message.clone());
                inner.voice.phase = "error".into();
                inner.voice.message = message;
            }
            let overlay = WebviewWindowBuilder::new(
                app,
                "overlay",
                WebviewUrl::App("index.html?overlay".into()),
            )
            .title("Scribe Voice recording")
            .inner_size(360.0, 78.0)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .visible(false)
            .focused(false)
            .focusable(false)
            .resizable(false)
            .build()?;
            overlay.set_ignore_cursor_events(true)?;
            use tauri::{
                menu::{Menu, MenuItem},
                tray::TrayIconBuilder,
            };
            let show = MenuItem::with_id(app, "show", "Open Scribe Voice", true, None::<&str>)?;
            let cancel = MenuItem::with_id(
                app,
                "cancel",
                "Cancel current dictation",
                true,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &cancel, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Scribe Voice — voice input")
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "cancel" => cancel_session(app),
                    "quit" => {
                        cancel_session(app);
                        app.exit(0);
                    }
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            startup_trace("setup complete");
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_bootstrap,
            save_settings,
            set_api_key,
            delete_api_key,
            probe_microphone,
            open_microphone_settings,
            start_recording,
            stop_recording,
            cancel_recording,
            copy_text,
            list_history,
            clear_history,
            hide_window
        ])
        .run(tauri::generate_context!())
        .expect("Failed to start Scribe Voice");
}
