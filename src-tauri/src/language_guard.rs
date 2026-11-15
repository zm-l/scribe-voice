use crate::{languages, model::Settings};

fn latin_letter(c: char) -> bool {
    matches!(c as u32, 0x0041..=0x007a | 0x00c0..=0x024f | 0x1d00..=0x1dbf | 0x1e00..=0x1eff | 0xab30..=0xab6f | 0xff21..=0xff5a)
}

// This is a conservative script check, NOT an independent language detector.
// It cannot tell English from Spanish/French, or disambiguate every short name.
fn incompatible_with_english(text: &str) -> bool {
    let mut latin = 0usize;
    let mut other = 0usize;
    for c in text.chars().filter(|c| c.is_alphabetic()) {
        if latin_letter(c) {
            latin += 1;
        } else {
            other += 1;
        }
    }
    other >= 2 && (latin == 0 || other * 100 >= (latin + other) * 35)
}

pub fn check(
    text: &str,
    settings: &Settings,
    reported_language: Option<&str>,
) -> Result<(), String> {
    if languages::hint(&settings.language)?.as_deref() != Some("en") {
        return Ok(());
    }
    if incompatible_with_english(text) {
        return Err("English was selected, but the transcript is mainly in another writing system. Nothing was pasted or translated. Review Raw, check the recording language, or select Gemini guided audio and try again.".into());
    }
    if let Some(language) = reported_language {
        if languages::normalize(language).ok().as_deref() != Some("en") {
            return Err("English was selected, but the recognition model did not report English speech. Nothing was pasted or translated. Review Raw; use Auto-detect if you actually mixed languages, or try the guided English preset.".into());
        }
    }
    Ok(())
}

pub fn cleanup_check(raw: &str, clean: &str, settings: &Settings) -> Result<(), String> {
    if languages::hint(&settings.language)?.as_deref() == Some("en")
        && !incompatible_with_english(raw)
        && incompatible_with_english(clean)
    {
        return Err("Cleanup changed the English transcript into another writing system. Original English transcript preserved.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn english() -> Settings {
        Settings {
            language: "en".into(),
            ..Settings::default()
        }
    }
    #[test]
    fn rejects_chinese_for_english_session() {
        for text in [
            "你好",
            "请明天给我发电子邮件。",
            "Привет, отправь письмо.",
            "مرحبا ارسل رسالة",
        ] {
            assert!(check(text, &english(), None).is_err());
        }
    }
    #[test]
    fn permits_english_names_numbers_and_small_code_switches() {
        for text in [
            "Please send the email tomorrow.",
            "Scribe Voice",
            "2026-10-31",
            "Hello, José and Zoë.",
            "Please send 张三 the email.",
            "Use variable α.",
        ] {
            assert!(check(text, &english(), Some("en")).is_ok());
        }
    }
    #[test]
    fn guided_language_report_catches_other_latin_languages() {
        assert!(check(
            "Bonjour, veuillez envoyer le courrier demain.",
            &english(),
            Some("fr")
        )
        .is_err());
        assert!(check("Please send it tomorrow.", &english(), Some("unknown")).is_err());
        assert!(check("Please send it tomorrow.", &english(), Some("English")).is_ok());
        // Without a model language report, script alone cannot detect French.
        assert!(check("Bonjour demain", &english(), None).is_ok());
    }
    #[test]
    fn auto_and_non_english_hints_are_not_forced_to_english() {
        assert!(check("你好，API。", &Settings::default(), Some("zh")).is_ok());
        let chinese = Settings {
            language: "zh".into(),
            ..Settings::default()
        };
        assert!(check("你好，API。", &chinese, Some("zh")).is_ok());
    }
    #[test]
    fn cleanup_must_not_change_english_into_chinese() {
        assert!(cleanup_check("Please email me.", "请给我发邮件。", &english()).is_err());
        assert!(cleanup_check("please email me", "Please email me.", &english()).is_ok());
        assert!(cleanup_check("Hello José", "Hello, José.", &english()).is_ok());
    }
}
