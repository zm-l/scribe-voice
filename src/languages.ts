import catalog from './data/languages.json';

export const recognitionLanguages = catalog.languages;
export type RecognitionLanguage = (typeof recognitionLanguages)[number];
const lookup = new Map<string, string>();
for (const language of recognitionLanguages) {
  for (const name of language.aliases) lookup.set(name.trim().toLowerCase(), language.code);
}
for (const language of recognitionLanguages) {
  lookup.set(language.code, language.code);
  lookup.set(language.name.toLowerCase(), language.code);
}

/** Returns a canonical ISO-639-1 code (or auto); unknown text is never sent upstream. */
export function normalizeRecognitionLanguage(value: string): string | null {
  if (value.length > 100) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'auto') return 'auto';
  if (!normalized) return null;
  return lookup.get(normalized) ?? null;
}

export function recognitionLanguageLabel(value: string): string {
  if (value === 'auto') return 'Auto-detect';
  const code = normalizeRecognitionLanguage(value);
  return recognitionLanguages.find(language => language.code === code)?.name ?? value;
}

export function languageInputValue(value: string): string {
  // Format only saved/external values; the combobox keeps live search text separately.
  const code = value.trim().toLowerCase();
  return recognitionLanguages.find(language => language.code === code)?.name ?? value;
}

const searchKey = (value: string) => value.trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
export function searchRecognitionLanguages(query: string, limit = 40): RecognitionLanguage[] {
  const key = searchKey(query);
  if (!key) return recognitionLanguages.slice(0, limit);
  return recognitionLanguages.map(language => {
    const name = searchKey(language.name);
    const aliases = language.aliases.map(searchKey);
    const score = name.startsWith(key) ? 0
      : language.code === key ? 1
      : aliases.some(alias => alias.startsWith(key)) ? 2
      : name.includes(key) ? 3
      : language.code.startsWith(key) ? 4
      : aliases.some(alias => alias.includes(key)) ? 5 : Infinity;
    return { language, score };
  }).filter(result => Number.isFinite(result.score))
    .sort((a, b) => a.score - b.score || a.language.name.localeCompare(b.language.name, 'en'))
    .slice(0, limit).map(result => result.language);
}
