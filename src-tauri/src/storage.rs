use crate::model::{HistoryEntry, Settings, VoiceState};
use rusqlite::{params, Connection};
use std::path::Path;

pub struct Storage {
    connection: Connection,
}
impl Storage {
    pub fn open(path: &Path) -> Result<Self, String> {
        let connection =
            Connection::open(path).map_err(|e| format!("Cannot open local app data: {e}"))?;
        connection.execute_batch("PRAGMA journal_mode=DELETE; PRAGMA secure_delete=ON; CREATE TABLE IF NOT EXISTS preferences (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, raw_text TEXT NOT NULL, text TEXT NOT NULL, model TEXT NOT NULL, insertion TEXT NOT NULL);").map_err(|e|e.to_string())?;
        Ok(Self { connection })
    }
    pub fn settings(&self) -> Settings {
        self.connection
            .query_row("SELECT json FROM preferences WHERE id=1", [], |r| {
                r.get::<_, String>(0)
            })
            .ok()
            .and_then(|j| serde_json::from_str::<Settings>(&j).ok())
            .filter(|s| s.validate().is_ok())
            .unwrap_or_default()
    }
    pub fn save_settings(&self, settings: &Settings) -> Result<(), String> {
        let json = serde_json::to_string(settings).map_err(|e| e.to_string())?;
        self.connection.execute("INSERT INTO preferences(id,json) VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET json=excluded.json",[json]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn add_history(&self, state: &VoiceState, model: &str) -> Result<(), String> {
        self.connection.execute("INSERT INTO history(created_at,raw_text,text,model,insertion) VALUES(?1,?2,?3,?4,?5)",params![chrono::Utc::now().to_rfc3339(),state.raw_text,state.text,model,state.insertion]).map_err(|e|e.to_string())?;
        self.connection.execute("DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT 50)",[]).map_err(|e|e.to_string())?;
        Ok(())
    }
    pub fn history(&self) -> Result<Vec<HistoryEntry>, String> {
        let mut stmt=self.connection.prepare("SELECT id,created_at,raw_text,text,model,insertion FROM history ORDER BY id DESC LIMIT 50").map_err(|e|e.to_string())?;
        let rows = stmt
            .query_map([], |r| {
                Ok(HistoryEntry {
                    id: r.get(0)?,
                    created_at: r.get(1)?,
                    raw_text: r.get(2)?,
                    text: r.get(3)?,
                    model: r.get(4)?,
                    insertion: r.get(5)?,
                })
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }
    pub fn clear(&self) -> Result<(), String> {
        self.connection
            .execute("DELETE FROM history", [])
            .map_err(|e| e.to_string())?;
        self.connection
            .execute_batch("VACUUM;")
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn settings_and_history_roundtrip() {
        let db = Storage::open(Path::new(":memory:")).unwrap();
        let s = Settings::default();
        db.save_settings(&s).unwrap();
        assert_eq!(db.settings().shortcut, s.shortcut);
        let mut v = VoiceState::default();
        v.text = "你好 API".into();
        db.add_history(&v, "test").unwrap();
        assert_eq!(db.history().unwrap()[0].text, "你好 API");
        db.clear().unwrap();
        assert!(db.history().unwrap().is_empty());
    }
    #[test]
    fn old_and_new_language_preferences_survive_roundtrip() {
        let db = Storage::open(Path::new(":memory:")).unwrap();
        for language in ["auto", "en", "zh", "ja", "ta", "es"] {
            let settings = Settings {
                language: language.into(),
                ..Settings::default()
            };
            db.save_settings(&settings).unwrap();
            assert_eq!(db.settings().language, language);
        }
        let legacy: Settings = serde_json::from_str("{\"shortcut\":\"Ctrl+Shift+Space\"}").unwrap();
        assert_eq!(legacy.language, "auto");
        assert!(legacy.validate().is_ok());
    }
    #[test]
    fn history_is_bounded() {
        let db = Storage::open(Path::new(":memory:")).unwrap();
        for _ in 0..60 {
            db.add_history(&VoiceState::default(), "test").unwrap();
        }
        assert_eq!(db.history().unwrap().len(), 50);
    }
}
