use serde::{Deserialize, Serialize};

pub const MAX_DURATION_MS: u64 = 120_000;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ActivationMode {
    Toggle,
    Hold,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub shortcut: String,
    pub activation_mode: ActivationMode,
    pub cleanup_enabled: bool,
    pub save_history: bool,
    pub language: String,
    pub transcription_model: String,
    pub cleanup_model: String,
    pub onboarding_complete: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            shortcut: "Ctrl+Shift+Space".into(),
            activation_mode: ActivationMode::Toggle,
            cleanup_enabled: true,
            save_history: false,
            language: "auto".into(),
            transcription_model: "openai/gpt-4o-mini-transcribe".into(),
            cleanup_model: "openai/gpt-4.1-mini".into(),
            onboarding_complete: false,
        }
    }
}
impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        crate::languages::normalize(&self.language)?;
        if ![
            "openai/gpt-4o-mini-transcribe",
            "openai/gpt-4o-transcribe",
            "google/gemini-2.5-flash",
        ]
        .contains(&self.transcription_model.as_str())
        {
            return Err("Unsupported transcription model.".into());
        }
        if self.cleanup_model != "openai/gpt-4.1-mini" {
            return Err("Unsupported cleanup model.".into());
        }
        if self.shortcut.len() > 100
            || !self.shortcut.contains('+')
            || self.shortcut.eq_ignore_ascii_case("Escape")
        {
            return Err("Use a shortcut with modifiers, such as Ctrl+Shift+Space.".into());
        }
        if self
            .shortcut
            .split('+')
            .last()
            .unwrap_or("")
            .eq_ignore_ascii_case("Escape")
        {
            return Err("Escape is reserved for cancelling a recording.".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VoiceState {
    pub phase: String,
    pub session_id: u64,
    pub level: f64,
    pub duration_ms: u64,
    pub raw_text: String,
    pub text: String,
    pub message: String,
    pub insertion: String,
    pub target_app: String,
    #[serde(default = "default_language_hint")]
    pub language_hint: String,
    #[serde(default)]
    pub transcription_model: String,
}
fn default_language_hint() -> String {
    "auto".into()
}
impl Default for VoiceState {
    fn default() -> Self {
        Self {
            phase: "idle".into(),
            session_id: 0,
            level: 0.0,
            duration_ms: 0,
            raw_text: String::new(),
            text: String::new(),
            message: "Ready when you are.".into(),
            insertion: "none".into(),
            target_app: String::new(),
            language_hint: default_language_hint(),
            transcription_model: String::new(),
        }
    }
}
impl VoiceState {
    pub fn busy(&self) -> bool {
        matches!(
            self.phase.as_str(),
            "starting" | "recording" | "transcribing" | "cleaning"
        )
    }
    pub fn recover_shortcut(&mut self, previous_error: Option<&str>, active: &str) {
        if self.phase == "error" && previous_error == Some(self.message.as_str()) {
            self.phase = if self.text.is_empty() { "idle" } else { "done" }.into();
            self.message = format!("Ready. {active} is active.");
        }
    }
}
#[derive(Clone, Serialize)]
pub struct HistoryEntry {
    pub id: i64,
    pub created_at: String,
    pub raw_text: String,
    pub text: String,
    pub model: String,
    pub insertion: String,
}
#[derive(Serialize)]
pub struct Bootstrap {
    pub settings: Settings,
    pub state: VoiceState,
    pub has_api_key: bool,
    pub platform: &'static str,
    pub version: &'static str,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_are_safe() {
        let s = Settings::default();
        assert!(!s.save_history);
        assert!(s.validate().is_ok());
    }
    #[test]
    fn guided_model_is_opt_in_and_snapshot_starts_empty() {
        let s = Settings::default();
        assert_eq!(s.transcription_model, "openai/gpt-4o-mini-transcribe");
        let guided = Settings {
            transcription_model: "google/gemini-2.5-flash".into(),
            language: "en".into(),
            ..s
        };
        assert!(guided.validate().is_ok());
        let voice = VoiceState::default();
        assert_eq!(voice.language_hint, "auto");
        assert!(voice.transcription_model.is_empty());
    }
    #[test]
    fn rejects_unknown_models_and_language() {
        let mut s = Settings::default();
        s.transcription_model = "anything".into();
        assert!(s.validate().is_err());
        s = Settings::default();
        s.language = "bad".into();
        assert!(s.validate().is_err());
    }
    #[test]
    fn escape_is_reserved() {
        let mut s = Settings::default();
        s.shortcut = "Ctrl+Escape".into();
        assert!(s.validate().is_err());
    }
    #[test]
    fn busy_phases() {
        let mut s = VoiceState::default();
        assert!(!s.busy());
        for p in ["starting", "recording", "transcribing", "cleaning"] {
            s.phase = p.into();
            assert!(s.busy());
        }
    }
    #[test]
    fn a_saved_shortcut_clears_its_stale_startup_error() {
        let mut s = VoiceState::default();
        s.phase = "error".into();
        s.message = "Ctrl+Shift+G unavailable".into();
        s.recover_shortcut(Some("Ctrl+Shift+G unavailable"), "Ctrl+Shift+T");
        assert_eq!(s.phase, "idle");
        assert!(s.message.contains("Ctrl+Shift+T"));
    }
    #[test]
    fn shortcut_recovery_does_not_clear_an_unrelated_transcription_error() {
        let mut s = VoiceState::default();
        s.phase = "error".into();
        s.message = "Insufficient AI credits".into();
        s.recover_shortcut(Some("Ctrl+Shift+G unavailable"), "Ctrl+Shift+T");
        assert_eq!(s.phase, "error");
        assert_eq!(s.message, "Insufficient AI credits");
    }
    #[test]
    fn shortcut_recovery_preserves_existing_transcript_text() {
        let mut s = VoiceState::default();
        s.phase = "error".into();
        s.message = "shortcut unavailable".into();
        s.text = "Keep this transcript".into();
        s.recover_shortcut(Some("shortcut unavailable"), "Ctrl+Shift+T");
        assert_eq!(s.phase, "done");
        assert_eq!(s.text, "Keep this transcript");
    }
}
