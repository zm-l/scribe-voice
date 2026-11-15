import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RecognitionLanguageField } from './RecognitionLanguageField';
import { LastRecordingRecognitionDiagnostic, SettingsView } from './App';
import { defaultSettings, defaultVoiceState, type Settings } from './types';

afterEach(cleanup);
function FieldHarness({ initial = 'auto', disabled = false }) {
  const [value, setValue] = useState(initial);
  return <RecognitionLanguageField value={value} onChange={setValue} disabled={disabled} />;
}
const hintRadio = () => screen.getByRole('radio', { name: /Hint the spoken language/ });
const autoRadio = () => screen.getByRole('radio', { name: /Auto-detect/ });
const hintInput = () => screen.getByLabelText('Spoken-language hint') as HTMLInputElement;

it('defaults to Auto without exposing a translation control', () => {
  render(<FieldHarness />);
  expect((autoRadio() as HTMLInputElement).checked).toBe(true);
  expect(screen.queryByLabelText('Spoken-language hint')).toBeNull();
  expect(screen.queryByRole('combobox', { name: /Output language/ })).toBeNull();
});
it('allows typed hints and remembers the hint when toggling modes', () => {
  render(<FieldHarness />);
  fireEvent.click(hintRadio());
  fireEvent.change(hintInput(), { target: { value: 'Japanese' } });
  expect(screen.getByRole('status').textContent).toContain('API hint: ja');
  fireEvent.click(autoRadio());
  expect(screen.queryByLabelText('Spoken-language hint')).toBeNull();
  fireEvent.click(hintRadio());
  expect(hintInput().value).toBe('Japanese');
});
it('flags invalid hints and respects disabled preview controls', () => {
  const view = render(<FieldHarness initial="ja" />);
  fireEvent.change(hintInput(), { target: { value: 'not-a-language' } });
  expect(hintInput().getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByRole('alert').textContent).toContain('two-letter');
  view.unmount();
  render(<FieldHarness initial="en" disabled />);
  expect(hintInput().disabled).toBe(true);
  expect((autoRadio() as HTMLInputElement).disabled).toBe(true);
});

function renderSettings(initial: Settings = defaultSettings, desktop = true) {
  const saved = vi.fn();
  function Harness() {
    const [settings, setSettings] = useState(initial);
    return <SettingsView desktop={desktop} settings={settings} hasApiKey={false} pending={null}
      onSave={async next => { saved(next); setSettings(next); return true; }}
      onSetApiKey={async () => false} onDeleteApiKey={() => {}}
      onOpenMicrophoneSettings={() => {}} />;
  }
  render(<Harness />);
  return saved;
}
const saveButton = () => screen.getByRole('button', { name: /Save changes/ }) as HTMLButtonElement;
it('blocks invalid saves and sends canonical ja instead of the typed name', async () => {
  const saved = renderSettings();
  fireEvent.click(hintRadio());
  expect(saveButton().disabled).toBe(true);
  fireEvent.change(hintInput(), { target: { value: 'unknown language' } });
  expect(saveButton().disabled).toBe(true);
  expect(saved).not.toHaveBeenCalled();
  fireEvent.change(hintInput(), { target: { value: '日本語' } });
  expect(saveButton().disabled).toBe(false);
  fireEvent.click(saveButton());
  await waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ language: 'ja' })));
  await waitFor(() => expect(saveButton().disabled).toBe(true));
  expect(hintInput().value).toBe('Japanese');
});
it('saves Auto when a previous hint is turned off', async () => {
  const saved = renderSettings({ ...defaultSettings, language: 'ja' });
  fireEvent.click(autoRadio());
  fireEvent.click(saveButton());
  await waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ language: 'auto' })));
});
it('loads legacy English/Chinese preferences as hints', () => {
  renderSettings({ ...defaultSettings, language: 'zh' });
  expect(hintInput().value).toBe('Chinese');
  expect(screen.getByRole('status').textContent).toContain('API hint: zh');
  expect(saveButton().disabled).toBe(true);
});

it('preserves ch as typed, shows Chinese, and saves zh when Chinese is selected', async () => {
  const saved = renderSettings();
  fireEvent.click(hintRadio());
  fireEvent.change(hintInput(), { target: { value: 'c' } });
  expect(hintInput().value).toBe('c');
  fireEvent.change(hintInput(), { target: { value: 'ch' } });
  expect(hintInput().value).toBe('ch');
  expect(screen.getByRole('option', { name: /Chinese/ })).toBeTruthy();
  expect(screen.getByRole('option', { name: /Chamorro/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('option', { name: /Chinese/ }));
  expect(hintInput().value).toBe('Chinese');
  expect(screen.queryByRole('listbox')).toBeNull();
  fireEvent.click(saveButton());
  await waitFor(() => expect(saved).toHaveBeenCalledWith(expect.objectContaining({ language: 'zh' })));
});
it('lets users finish Chinese through the valid ch code prefix without auto-expansion', () => {
  render(<FieldHarness />);
  fireEvent.click(hintRadio());
  for (const text of ['c', 'ch', 'chi', 'chin', 'chine', 'chines', 'Chinese']) {
    fireEvent.change(hintInput(), { target: { value: text } });
    expect(hintInput().value).toBe(text);
  }
  expect(screen.getByRole('status').textContent).toContain('API hint: zh');
});
it('supports keyboard selection and Escape without changing the current query', () => {
  render(<FieldHarness />);
  fireEvent.click(hintRadio());
  fireEvent.change(hintInput(), { target: { value: 'chin' } });
  fireEvent.keyDown(hintInput(), { key: 'ArrowDown' });
  expect(hintInput().getAttribute('aria-activedescendant')).toBeTruthy();
  fireEvent.keyDown(hintInput(), { key: 'Enter' });
  expect(hintInput().value).toBe('Chinese');
  fireEvent.focus(hintInput());
  expect(screen.getByRole('listbox')).toBeTruthy();
  fireEvent.keyDown(hintInput(), { key: 'Escape' });
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(hintInput().value).toBe('Chinese');
});
it('does not expand ta while searching for Tagalog', () => {
  render(<FieldHarness />);
  fireEvent.click(hintRadio());
  fireEvent.change(hintInput(), { target: { value: 'ta' } });
  expect(hintInput().value).toBe('ta');
  fireEvent.change(hintInput(), { target: { value: 'tag' } });
  expect(hintInput().value).toBe('tag');
  expect(screen.getByRole('option', { name: /Filipino/ })).toBeTruthy();
});

it('offers Gemini 2.5 Flash as the guided-audio model option', () => {
  renderSettings();
  const option = screen.getByRole('option', { name: 'Gemini 2.5 Flash — guided audio' }) as HTMLOptionElement;
  expect(option.value).toBe('google/gemini-2.5-flash');
  expect(screen.getByText(/Save changes is required/)).toBeTruthy();
  expect(screen.getByText(/does not translate an existing transcript/)).toBeTruthy();
});

it('uses guided English recognition only to update the canonical draft', () => {
  const saved = renderSettings();
  fireEvent.click(screen.getByRole('button', { name: 'Use guided English recognition' }));
  expect((screen.getByLabelText('Spoken-language hint') as HTMLInputElement).value).toBe('English');
  expect((screen.getByLabelText('Transcription model') as HTMLSelectElement).value).toBe('google/gemini-2.5-flash');
  expect(saveButton().disabled).toBe(false);
  expect(saved).not.toHaveBeenCalled();
});

it('commits guided English recognition only after Save changes and preserves other settings', async () => {
  const initial: Settings = {
    ...defaultSettings,
    shortcut: 'Ctrl+Alt+E',
    activation_mode: 'hold',
    cleanup_enabled: false,
    save_history: true,
  };
  const saved = renderSettings(initial);
  fireEvent.click(screen.getByRole('button', { name: 'Use guided English recognition' }));
  expect(saved).not.toHaveBeenCalled();
  fireEvent.click(saveButton());
  await waitFor(() => expect(saved).toHaveBeenCalledWith({
    ...initial,
    language: 'en',
    transcription_model: 'google/gemini-2.5-flash',
  }));
});

it('disables the guided English preset in browser preview', () => {
  renderSettings(defaultSettings, false);
  expect((screen.getByRole('button', { name: 'Use guided English recognition' }) as HTMLButtonElement).disabled).toBe(true);
});

it('reports the saved recording recognition snapshot instead of current settings', () => {
  const { rerender } = render(<LastRecordingRecognitionDiagnostic voice={{
    ...defaultVoiceState,
    session_id: 12,
    language_hint: 'ja',
    transcription_model: 'openai/gpt-4o-mini-transcribe',
  }} />);
  const diagnostic = screen.getByRole('region', { name: 'Last recording recognition diagnostic' });
  expect(diagnostic.textContent).toContain('Japanese (ja)');
  expect(diagnostic.textContent).toContain('openai/gpt-4o-mini-transcribe');
  expect(screen.queryByText('Gemini 2.5 Flash')).toBeNull();

  rerender(<LastRecordingRecognitionDiagnostic voice={{
    ...defaultVoiceState,
    session_id: 13,
    language_hint: 'auto',
    transcription_model: 'google/gemini-2.5-flash',
  }} />);
  expect(diagnostic.textContent).toContain('Auto (auto)');
  expect(diagnostic.textContent).toContain('google/gemini-2.5-flash');
});
