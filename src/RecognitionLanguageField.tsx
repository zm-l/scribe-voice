import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { languageInputValue, normalizeRecognitionLanguage, recognitionLanguageLabel, searchRecognitionLanguages, type RecognitionLanguage } from './languages';

export function RecognitionLanguageField({ value, onChange, disabled = false }: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const resolved = normalizeRecognitionLanguage(value);
  const automatic = resolved === 'auto';
  const initialQuery = automatic ? '' : languageInputValue(value);
  const [query, setQuery] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const emitted = useRef(value);
  const lastHint = useRef({ value: automatic ? '' : value, query: initialQuery });
  const input = useRef<HTMLInputElement>(null);
  const options = useRef<Array<HTMLLIElement | null>>([]);
  const matches = useMemo(() => searchRecognitionLanguages(query), [query]);
  const expanded = open && !automatic && !disabled;

  // Only format external/saved updates. Never expand a live query such as ch into Chamorro.
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    const label = automatic ? '' : languageInputValue(value);
    setQuery(label);
    if (!automatic) lastHint.current = { value, query: label };
    else setOpen(false);
  }, [value, automatic]);
  useEffect(() => { setActiveIndex(-1); }, [query]);
  useEffect(() => {
    if (expanded && activeIndex >= 0) options.current[activeIndex]?.scrollIntoView?.({ block: 'nearest' });
  }, [expanded, activeIndex]);

  const emit = (next: string) => { emitted.current = next; onChange(next); };
  const setAutomatic = () => { emit('auto'); setQuery(''); setOpen(false); };
  const edit = (text: string) => {
    if (normalizeRecognitionLanguage(text) === 'auto') { setAutomatic(); return; }
    setQuery(text);
    lastHint.current = { value: text, query: text };
    emit(text);
    setOpen(true);
    setActiveIndex(-1);
  };
  const select = (language: RecognitionLanguage) => {
    setQuery(language.name);
    lastHint.current = { value: language.code, query: language.name };
    emit(language.code);
    input.current?.focus();
    setOpen(false);
    setActiveIndex(-1);
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (matches.length) setActiveIndex(index => event.key === 'ArrowDown'
        ? (index + 1) % matches.length
        : index < 0 ? matches.length - 1 : (index - 1 + matches.length) % matches.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const exact = normalizeRecognitionLanguage(query);
      const selected = expanded && activeIndex >= 0 ? matches[activeIndex]
        : matches.find(language => language.code === exact) ?? (matches.length === 1 ? matches[0] : undefined);
      if (selected) select(selected);
      else { setOpen(true); setActiveIndex(matches.length ? 0 : -1); }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div className="recognition-language">
      <fieldset className="radio-group">
        <legend>Spoken-language recognition</legend>
        <label><input type="radio" name={`${id}-mode`} checked={automatic} onChange={setAutomatic} disabled={disabled} /><span><strong>Auto-detect</strong><small>The speech model identifies the language. No language hint is sent.</small></span></label>
        <label><input type="radio" name={`${id}-mode`} checked={!automatic} onChange={() => {
          setQuery(lastHint.current.query); emit(lastHint.current.value); setOpen(true);
        }} disabled={disabled} /><span><strong>Hint the spoken language</strong><small>Provide the language you are actually speaking, not a translation target.</small></span></label>
      </fieldset>
      {!automatic && <>
        <div className="language-search">
          <label className="field" htmlFor={`${id}-input`}><span>Spoken-language hint</span><input
            id={`${id}-input`} ref={input} role="combobox" dir="auto"
            value={query} onChange={event => edit(event.target.value)}
            onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={keyDown}
            aria-autocomplete="list" aria-expanded={expanded} aria-controls={`${id}-languages`}
            aria-activedescendant={expanded && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
            placeholder="Search a language name or code…"
            autoComplete="off" spellCheck={false} maxLength={100}
            disabled={disabled} aria-invalid={resolved === null}
            aria-describedby={`${id}-hint-status`}
          /></label>
          {expanded && <ul id={`${id}-languages`} role="listbox" aria-label="Matching spoken languages" className="language-suggestions">
            {matches.map((language, index) => <li key={language.code} id={`${id}-option-${index}`}
              ref={node => { options.current[index] = node; }} role="option" aria-selected={index === activeIndex}
              className={index === activeIndex ? 'is-active' : ''}
              onMouseDown={event => event.preventDefault()} onClick={() => select(language)}>
              <span>{language.name}</span><small>{language.code}</small>
            </li>)}
            {!matches.length && <li role="presentation" className="language-suggestions__empty">No matching language. Try a name or two-letter code.</li>}
          </ul>}
        </div>
        <small id={`${id}-hint-status`} role={resolved === null ? 'alert' : 'status'}>
          {resolved === null ? 'Choose a recognized language name or two-letter ISO-639-1 code. Region/dialect tags are not accepted.' : `API hint: ${resolved} — ${recognitionLanguageLabel(value)}. Your speech is transcribed, not translated.`}
        </small>
      </>}
      <p className="settings-copy">Search by name, code, or alias, then select a result (or use Arrow keys and Enter). Keep Auto-detect if unsure or switching languages. A correct hint may improve recognition; a wrong hint can reduce accuracy. Model language/dialect support varies.</p>
    </div>
  );
}
