import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AiError } from '@/lib/ai/ops';
import { saveTranslation, translateLines } from '@/lib/ai/translate';
import { captionLines } from '@/lib/project/captions';
import { toOut } from '@/lib/project/time';
import type { SlotProps } from '../components/slots';
import { clock } from '../format';
import { StateCard } from '../states/StateCard';
import { C, MONO } from '../ui';
import { statusOf } from './actions';
import { callWith, providerName, setup } from './deps';
import { setAi, useUnits } from './store';
import { BODY, BUTTON, Header, NotSetUp, Offline, PANEL, useOnline } from './ui';

/** Languages offered by "+ Add a language", in the frames' order: English name, then the name in that language. */
export const LANGUAGES: readonly (readonly [string, string])[] = [
  ['Spanish', 'Español'], ['French', 'Français'], ['German', 'Deutsch'], ['Portuguese', 'Português'], ['Italian', 'Italiano'],
  ['Dutch', 'Nederlands'], ['Polish', 'Polski'], ['Turkish', 'Türkçe'], ['Russian', 'Русский'], ['Arabic', 'العربية'], ['Hindi', 'हिन्दी'],
  ['Indonesian', 'Bahasa Indonesia'], ['Japanese', '日本語'], ['Korean', '한국어'], ['Chinese (Simplified)', '简体中文'],
];
/** The language the captions are spoken in; it is never offered as a translation. */
const SPOKEN = 'English';

/** "+ Add a language": a search field over the languages not yet added. */
function AddLanguage({ added, disabled, onPick }: { added: readonly string[]; disabled: boolean; onPick: (language: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const list = LANGUAGES.filter(([en, native]) => en !== SPOKEN && !added.includes(en) && (!q || en.toLowerCase().includes(q) || native.toLowerCase().includes(q)));
  const pick = (language: string) => { setOpen(false); setQuery(''); onPick(language); };
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" aria-expanded={open} disabled={disabled} onClick={() => setOpen((o) => !o)} style={CHIP(false)}>+ Add a language</button>
      {open && (
        <div role="dialog" aria-label="Add a language" style={{
          position: 'absolute', top: 30, left: 0, zIndex: 5, width: 220, maxHeight: 280, display: 'flex', flexDirection: 'column', borderRadius: 10,
          background: C.raised, border: `1px solid ${C.line}`, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', overflow: 'hidden',
        }}>
          <input aria-label="Search languages" autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && list[0]) pick(list[0][0]); }}
            style={{ margin: 6, height: 28, padding: '0 8px', borderRadius: 6, border: `1px solid ${C.line}`, background: C.ground, color: C.text, fontFamily: 'inherit', fontSize: 12.5, outline: 'none' }} />
          <div role="listbox" aria-label="Languages" style={{ overflowY: 'auto', padding: '0 4px 4px' }}>
            {list.map(([en, native]) => (
              <button key={en} type="button" role="option" aria-selected={false} onClick={() => pick(en)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', border: 0, borderRadius: 6, background: 'transparent', color: C.text, fontFamily: 'inherit', fontSize: 12.5, cursor: 'pointer' }}>
                {native} · <span style={{ color: C.muted }}>{en}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type Status = 'idle' | 'thinking' | 'failed' | 'not-set-up';

const CHIP = (on: boolean) => ({
  height: 26, padding: '0 10px', borderRadius: 999, fontSize: 12, display: 'flex', alignItems: 'center', fontFamily: 'inherit', cursor: 'pointer', boxSizing: 'border-box' as const,
  ...(on ? { background: C.tabOn, color: C.text, border: '1px solid transparent' } : { background: 'transparent', color: C.secondary, border: `1px solid ${C.line}` }),
});

/** TranslateCaptions: one language at a time, each line under its original and editable; Done saves it as one Undo step. */
export function TranslatePanel(p: SlotProps) {
  const { project, cut } = p;
  const online = useOnline();
  const units = useUnits(p.recording);
  const captions = useMemo(() => captionLines(units, project.wordFixes), [units, project.wordFixes]);
  const [language, setLanguage] = useState<string | null>(cut.captions.language ?? Object.keys(project.translations)[0] ?? null);
  const [lines, setLines] = useState<string[] | null>(language ? project.translations[language] ?? null : null);
  const [show, setShow] = useState(true);
  const [status, setStatus] = useState<Status>('idle');
  const [provider, setProvider] = useState('');
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  useEffect(() => {
    setup().then((s) => { setProvider(s ? providerName(s.provider) : ''); if (!s) setStatus('not-set-up'); }, () => {});
  }, []);

  const translate = async (lang: string) => {
    setLanguage(lang);
    setLines(null);
    if (!online) return;
    const s = await setup().catch(() => null);
    if (!s) { setStatus('not-set-up'); return; }
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    setStatus('thinking');
    try {
      const out = await translateLines(captions.map((c) => c.text), lang, callWith(s, controller.signal));
      if (running.current !== controller) return;
      setLines(out);
      setStatus('idle');
    } catch (error) {
      if (running.current !== controller) return;
      const st = statusOf(error);
      if (st === 'stopped') { setStatus('idle'); return; }
      if (!(error instanceof AiError)) console.error('Klipkord: could not translate the captions', error);
      setStatus(st === 'not-set-up' ? 'not-set-up' : 'failed');
    }
  };
  const pick = (lang: string) => {
    const saved = project.translations[lang];
    if (saved) { setLanguage(lang); setLines(saved); setStatus('idle'); } else void translate(lang);
  };
  const done = () => {
    if (language && lines) p.edit((q) => saveTranslation(q, { language, lines, show }));
    setAi({ panel: null });
  };
  const languages = [...new Set([...Object.keys(project.translations), ...(language ? [language] : [])])];

  let state = null;
  if (!online) state = <Offline />;
  else if (status === 'not-set-up') state = <NotSetUp />;
  else if (status === 'thinking') state = <StateCard state="ai-thinking" role="status" title="Reading your transcript…" body="" actions={[{ label: 'Stop', tone: 'secondary', onClick: () => { running.current?.abort(); setStatus('idle'); } }]} />;
  else if (status === 'failed') {
    state = (
      <StateCard state="translate-failed" role="alert" title="Couldn't translate the captions" body="Nothing was changed. The English captions are still on."
        actions={[{ label: 'Try again', tone: 'primary', onClick: () => language && void translate(language) }]} />
    );
  }

  return (
    <aside aria-label="Translate captions" style={PANEL}>
      <Header title={language ? `${language} captions` : 'Translate captions'} provider={provider} mark={false} onBack={() => setAi({ panel: null })} />
      <div style={BODY}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span style={CHIP(false)}>English</span>
          {languages.map((l) => <button key={l} type="button" onClick={() => pick(l)} style={CHIP(l === language)}>{l}</button>)}
          <AddLanguage added={languages} disabled={p.readOnly || status === 'thinking'} onPick={pick} />
        </div>
        <span style={{ fontSize: 12, color: C.secondary }}>Check the words, then pick which one shows in the video. Others export as SRT and VTT.</span>
        {state}
        {lines && (
          <div>
            {captions.map((c, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '34px 1fr', gap: '4px 8px', padding: '7px 0', borderBottom: `1px solid ${C.line}` }}>
                <span style={{ fontFamily: MONO, fontSize: 11, color: C.muted }}>{clock(toOut(cut, c.start) ?? c.start)}</span>
                <span style={{ fontSize: 12, color: C.muted }}>{c.text}</span>
                <span />
                <textarea aria-label={`Line ${i + 1}`} rows={1} value={lines[i] ?? ''} readOnly={p.readOnly}
                  onChange={(e) => setLines((ls) => ls && ls.map((l, k) => (k === i ? e.target.value : l)))}
                  style={{ fontSize: 13, fontFamily: 'inherit', color: C.text, background: 'transparent', border: '1px solid transparent', borderRadius: 6, padding: '3px 6px', margin: '-4px -7px', resize: 'none', fieldSizing: 'content' } as CSSProperties} />
              </div>
            ))}
          </div>
        )}
        {language && lines && (
          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', position: 'relative' }}>
              <span style={{ flexGrow: 1, fontSize: 13 }}>
                Show {language} in the video
                <span style={{ display: 'block', fontSize: 11.5, color: C.muted, marginTop: 2, lineHeight: 1.4 }}>English is still exported as a file.</span>
              </span>
              <input type="checkbox" role="switch" aria-label={`Show ${language} in the video`} checked={show} onChange={(e) => setShow(e.target.checked)}
                style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }} />
              <span aria-hidden="true" style={{ width: 34, height: 20, borderRadius: 10, flexShrink: 0, position: 'relative', background: show ? C.accent : C.line }}>
                <span style={{ position: 'absolute', top: 2, ...(show ? { right: 2 } : { left: 2 }), width: 16, height: 16, borderRadius: '50%', background: '#FFFFFF' }} />
              </span>
            </label>
            <button type="button" disabled={p.readOnly} onClick={done} style={{ ...BUTTON(true), flex: 'none' }}>Done</button>
          </div>
        )}
      </div>
    </aside>
  );
}
