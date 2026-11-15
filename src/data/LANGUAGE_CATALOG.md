# Spoken-language hint catalog

The 183 two-letter language codes and source name aliases come from the Library of Congress ISO code list: https://www.loc.gov/standards/iso639-2/php/code_list.php . Its UTF-8 data is available at https://www.loc.gov/standards/iso639-2/ISO-639-2_utf-8.txt . Only records with a current two-letter code in the retrieved data are used; three-letter-only languages and region/dialect tags are not invented or sent as hints.

Friendly English and native names were generated with the local platform's `Intl.DisplayNames` / ICU data. The generated JSON is used by both React and Rust, so names resolve to the same canonical API code. It is bundled with the executable; there is no language-name lookup service or AI call for selecting a hint.

A standard language code being valid is **not** a claim that a particular speech model supports that language or dialect well. Coverage and recognition quality vary. Unknown inputs are rejected before any provider request. Auto-detect sends no language parameter. Manual hints describe the speech language, not an output translation target.

The direct device download returned HTTP 403. The task's public-page extraction read the official UTF-8 listing successfully; its two-letter records were retained locally and used to generate this catalog on 31 October 2026.

Duplicate friendly names from ICU fall back to the official source names. For example, platform locale aliases can label both `ak` and `tw` as Akan; the catalog keeps Akan (`ak`) and Twi (`tw`) distinct. Aliases that conflict with another canonical name/code, or are ambiguous across languages, are removed. Tests cover the canonical name/code round trip.
