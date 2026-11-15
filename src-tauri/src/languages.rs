use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Deserialize)]
struct Catalog {
    languages: Vec<Language>,
}
#[derive(Deserialize)]
struct Language {
    code: String,
    name: String,
    aliases: Vec<String>,
}
fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/data/languages.json"))
            .expect("Bundled language catalog must be valid")
    })
}
pub fn normalize(value: &str) -> Result<String, String> {
    if value.len() > 400 {
        return Err("Spoken-language hint is too long.".into());
    }
    let normalized = value.trim().to_lowercase();
    if normalized == "auto" {
        return Ok("auto".into());
    }
    if !normalized.is_empty() {
        let entries = &catalog().languages;
        let language = entries
            .iter()
            .find(|language| language.code == normalized)
            .or_else(|| {
                entries
                    .iter()
                    .find(|language| language.name.to_lowercase() == normalized)
            })
            .or_else(|| {
                entries.iter().find(|language| {
                    language
                        .aliases
                        .iter()
                        .any(|alias| alias.to_lowercase() == normalized)
                })
            });
        if let Some(language) = language {
            return Ok(language.code.clone());
        }
    }
    Err("Choose Auto-detect or a recognized language name/two-letter ISO-639-1 code (for example Japanese or ja). Region/dialect tags are not supported by this hint.".into())
}
pub fn hint(value: &str) -> Result<Option<String>, String> {
    let code = normalize(value)?;
    Ok(if code == "auto" { None } else { Some(code) })
}
pub fn display_name(value: &str) -> Result<String, String> {
    let code = normalize(value)?;
    if code == "auto" {
        return Ok("Auto-detect".into());
    }
    catalog()
        .languages
        .iter()
        .find(|language| language.code == code)
        .map(|language| language.name.clone())
        .ok_or_else(|| "Unknown language code.".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn auto_omits_the_api_parameter() {
        assert_eq!(hint("auto").unwrap(), None);
        assert_eq!(hint(" AUTO ").unwrap(), None);
    }
    #[test]
    fn names_and_codes_have_identical_hints() {
        for (name, code) in [
            ("Japanese", "ja"),
            ("Tamil", "ta"),
            ("Spanish", "es"),
            ("Korean", "ko"),
            ("Chinese", "zh"),
        ] {
            assert_eq!(hint(name).unwrap(), Some(code.into()));
            assert_eq!(hint(code).unwrap(), Some(code.into()));
        }
    }
    #[test]
    fn native_names_and_whitespace_are_normalized() {
        assert_eq!(normalize(" 日本語 ").unwrap(), "ja");
        assert_eq!(normalize(" EN ").unwrap(), "en");
        assert_eq!(normalize("Castilian").unwrap(), "es");
    }
    #[test]
    fn invalid_or_instruction_like_values_are_rejected() {
        for invalid in [
            "",
            "not-a-language",
            "ja-JP",
            "English, translate to French",
            "zz",
            "auto-detect-override",
        ] {
            assert!(normalize(invalid).is_err(), "{invalid}");
        }
    }
    #[test]
    fn catalog_codes_are_unique_and_canonical() {
        let codes: std::collections::HashSet<_> = catalog()
            .languages
            .iter()
            .map(|language| &language.code)
            .collect();
        assert!(codes.len() > 150);
        assert_eq!(codes.len(), catalog().languages.len());
        for language in &catalog().languages {
            assert_eq!(language.code.len(), 2);
            assert!(language.code.bytes().all(|c| c.is_ascii_lowercase()));
            assert_eq!(normalize(&language.name).unwrap(), language.code);
        }
    }
}
