import { expect, it } from 'vitest';
import { languageInputValue, normalizeRecognitionLanguage, recognitionLanguageLabel, recognitionLanguages } from './languages';

it('keeps Auto as a distinct mode', () => {
  expect(normalizeRecognitionLanguage(' AUTO ')).toBe('auto');
  expect(recognitionLanguageLabel('auto')).toBe('Auto-detect');
});
it('normalizes spoken-language names, aliases, and codes', () => {
  for (const [value, code] of [['Japanese', 'ja'], [' JA ', 'ja'], ['Tamil', 'ta'], ['Castilian', 'es'], ['English', 'en']]) expect(normalizeRecognitionLanguage(value)).toBe(code);
});
it('accepts native-language names without sending free text to the API', () => {
  for (const [value, code] of [['日本語', 'ja'], ['中文', 'zh'], ['தமிழ்', 'ta'], ['español', 'es']]) expect(normalizeRecognitionLanguage(value)).toBe(code);
});
it('rejects incomplete, unknown, regional, and instruction-like inputs', () => {
  for (const value of ['', 'Jap', 'zz', 'ja-JP', 'English, translate to French', ' '.repeat(101) + 'auto']) expect(normalizeRecognitionLanguage(value)).toBeNull();
});
it('catalog codes are unique two-letter identifiers', () => {
  expect(recognitionLanguages.length).toBe(183);
  expect(new Set(recognitionLanguages.map(language => language.code)).size).toBe(recognitionLanguages.length);
  for (const language of recognitionLanguages) expect(language.code).toMatch(/^[a-z]{2}$/);
});
it('every displayed language name resolves back to its catalog code', () => {
  for (const language of recognitionLanguages) expect(normalizeRecognitionLanguage(language.name)).toBe(language.code);
});
it('displays saved codes as names while preserving partially typed text', () => {
  expect(languageInputValue('ja')).toBe('Japanese');
  expect(languageInputValue('Jap')).toBe('Jap');
  expect(recognitionLanguageLabel('ta')).toBe('Tamil');
});

it('keeps distinct standard names distinct despite platform locale aliases', () => {
  expect(normalizeRecognitionLanguage('Akan')).toBe('ak');
  expect(normalizeRecognitionLanguage('Twi')).toBe('tw');
  for (const language of recognitionLanguages) expect(normalizeRecognitionLanguage(language.code)).toBe(language.code);
});

it('ch searches names as well as the Chamorro code', async () => {
  const { searchRecognitionLanguages } = await import('./languages');
  const codes = searchRecognitionLanguages('ch').map(language => language.code);
  expect(codes).toContain('zh');
  expect(codes).toContain('ch');
  expect(codes.length).toBeGreaterThan(1);
});
it('chi narrows the search toward Chinese rather than locking to Chamorro', async () => {
  const { searchRecognitionLanguages } = await import('./languages');
  const codes = searchRecognitionLanguages('chi').map(language => language.code);
  expect(codes).toContain('zh');
  expect(codes).not.toContain('ch');
});
it('search accepts code, alias, native name, and case-insensitive queries', async () => {
  const { searchRecognitionLanguages } = await import('./languages');
  for (const [query, code] of [['zh', 'zh'], ['CASTIL', 'es'], ['日本', 'ja'], ['francais', 'fr']]) {
    expect(searchRecognitionLanguages(query).map(language => language.code)).toContain(code);
  }
});
it('unknown search text produces no suggestions without inventing a language', async () => {
  const { searchRecognitionLanguages } = await import('./languages');
  expect(searchRecognitionLanguages('not-a-real-language-999')).toEqual([]);
});
