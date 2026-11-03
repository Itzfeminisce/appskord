/** Frame Dictate: the mic in a text box. Press to listen, press again to write the words in at the cursor. */
import { PROVIDERS } from '@appskord/llm';
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { aiKey, hasHostAccess, loadedKeyNames, requestHostAccess } from '@/lib/keys';
import { insertWords } from './insert';
import { barHeights, clock, dictate, IDLE, pressAction, type DictatePhase } from './machine';
import { MIC_MESSAGE, micPermission, micSettingsUrl, openMic, Recording, type MicMessage } from './recorder';
import { SpeechError, speechModel, speechProvider, transcribe, type SpeechProvider } from './speech';
import './dictate.css';

type Field = HTMLTextAreaElement | HTMLInputElement;

export interface DictationOptions {
  field: RefObject<Field | null>;
  /** The side panel can't show Chrome's mic prompt, so it asks from a small tab. */
  where: 'tab' | 'panel';
  /** Bars while listening: 9 in a text area, 7 in a one-line field. */
  bars?: number;
  /** Settings, "AI and keys". */
  onAddKey(): void;
  /** The field's new value once the words are in; board fields save it as one Undo step. */
  onInserted?(value: string): void;
}

const MicIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
const StopIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="10" height="10" rx="2" fill="currentColor" /></svg>
);
const Spinner = () => (
  <svg className="bk-dict-spin" width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="var(--bk-dict-ring)" />
    <path d="M12 3a9 9 0 0 1 9 9" stroke="var(--bk-accent)" />
  </svg>
);
const KeyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 9-9M17 6l3 3M15 8l2 2" />
  </svg>
);
const WarnIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 4 2.5 20h19z" />
    <path d="M12 10v4M12 17v.01" />
  </svg>
);

/** Key names (never values) loaded now, kept fresh, so a press knows its provider before any await. */
function useKeyNames() {
  const names = useRef<string[] | undefined>(undefined);
  const host = useRef<Partial<Record<SpeechProvider, boolean>>>({});
  useEffect(() => {
    let alive = true;
    const load = () =>
      void loadedKeyNames()
        .then(async (list) => {
          if (!alive) return;
          names.current = list;
          const p = speechProvider(list);
          if (p) host.current[p] = await hasHostAccess(p);
        })
        .catch((error: unknown) => console.error('Briefkord: could not load the speech key', error));
    load();
    const changed = (changes: Record<string, unknown>, area: string) => area === 'session' && 'apiKeys' in changes && load();
    browser.storage.onChanged.addListener(changed);
    return () => {
      alive = false;
      browser.storage.onChanged.removeListener(changed);
    };
  }, []);
  return { names, host };
}

function mirrorStyle(field: Field): CSSProperties {
  const cs = getComputedStyle(field);
  const line = field instanceof HTMLInputElement;
  return {
    top: field.offsetTop,
    left: field.offsetLeft,
    width: field.offsetWidth,
    height: field.offsetHeight,
    font: cs.font,
    letterSpacing: cs.letterSpacing,
    lineHeight: line ? `${field.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)}px` : cs.lineHeight,
    padding: cs.padding,
    borderStyle: 'solid',
    borderColor: 'transparent',
    borderWidth: cs.borderWidth,
    whiteSpace: line ? 'pre' : 'pre-wrap',
  };
}

/** The dictated words tinted teal for 2 s: a copy of the field's text laid over it. */
function Tint({ field, from, to }: { field: Field; from: number; to: number }) {
  const [scroll, setScroll] = useState({ top: field.scrollTop, left: field.scrollLeft });
  const [, relayout] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const watch = new ResizeObserver(() => relayout());
    watch.observe(field);
    return () => watch.disconnect();
  }, [field]);
  useEffect(() => {
    const on = () => setScroll({ top: field.scrollTop, left: field.scrollLeft });
    field.addEventListener('scroll', on);
    return () => field.removeEventListener('scroll', on);
  }, [field]);
  const [style, setStyle] = useState<CSSProperties>();
  // Measured after layout: the row beside the field changes width in the same render.
  useLayoutEffect(() => {
    const next = mirrorStyle(field);
    setStyle((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  });
  if (!style) return null;
  const value = field.value;
  return (
    <span aria-hidden="true" className="bk-dict-tint" style={style}>
      <span style={{ display: 'block', transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }}>
        {value.slice(0, from)}
        <mark>{value.slice(from, to)}</mark>
        {value.slice(to)}
        {'\u200b'}
      </span>
    </span>
  );
}

export function useDictation({ field, where, bars = 9, onAddKey, onInserted }: DictationOptions) {
  const [phase, send] = useReducer(dictate, IDLE);
  const keys = useKeyNames();
  const rec = useRef<Recording | undefined>(undefined);
  const provider = useRef<SpeechProvider | undefined>(undefined);
  const ctrl = useRef<AbortController | undefined>(undefined);
  const micTab = useRef<number | undefined>(undefined);
  const [levels, setLevels] = useState<number[]>(() => Array(bars).fill(4));
  const [now, setNow] = useState(0);
  const [tint, setTint] = useState<{ from: number; to: number }>();
  const live = useRef({ onInserted });
  live.current = { onInserted };

  const discard = useCallback(() => {
    rec.current?.discard();
    rec.current = undefined;
    ctrl.current?.abort();
  }, []);
  useEffect(() => discard, [discard]);

  // Level bars and timer while listening.
  useEffect(() => {
    if (phase.kind !== 'listening') return;
    const tick = setInterval(() => {
      setNow(Date.now());
      if (rec.current) setLevels(barHeights(rec.current.level(), bars));
    }, 90);
    return () => clearInterval(tick);
  }, [phase.kind, bars]);

  // Esc while listening throws the audio away, before any other Esc handler (dialog, card, panel).
  useEffect(() => {
    if (phase.kind !== 'listening') return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      discard();
      send({ type: 'reset' });
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [phase.kind, discard]);

  // The side panel's mic tab answers once Chrome has.
  useEffect(() => {
    if (where !== 'panel' || phase.kind !== 'asking') return;
    const on = (msg: unknown) => {
      const m = msg as MicMessage;
      if (m?.type === MIC_MESSAGE) send(m.allowed ? { type: 'reset' } : { type: 'blocked' });
    };
    // Closed without an answer: the mic goes back to how it was.
    const closed = (id: number) => id === micTab.current && send({ type: 'reset' });
    browser.runtime.onMessage.addListener(on);
    browser.tabs.onRemoved.addListener(closed);
    return () => {
      browser.runtime.onMessage.removeListener(on);
      browser.tabs.onRemoved.removeListener(closed);
    };
  }, [where, phase.kind]);

  useEffect(() => {
    if (!tint) return;
    const el = field.current;
    const timer = setTimeout(() => setTint(undefined), 2000);
    // After the event is done: a render inside it would put the old value back before React sees the edit.
    let later: ReturnType<typeof setTimeout> | undefined;
    const clear = () => (later = setTimeout(() => setTint(undefined)));
    el?.addEventListener('input', clear);
    return () => {
      clearTimeout(timer);
      clearTimeout(later);
      el?.removeEventListener('input', clear);
    };
  }, [tint, field]);

  const listen = async (p: SpeechProvider, asked: Promise<boolean>) => {
    if (!(await asked)) return send({ type: 'fail', why: 'site', provider: p });
    keys.host.current[p] = true;
    if (where === 'panel') {
      const state = await micPermission();
      if (state === 'denied') return send({ type: 'blocked' });
      if (state === 'prompt') {
        micTab.current = (await browser.tabs.create({ url: browser.runtime.getURL('/mic.html') })).id;
        return;
      }
    }
    const stream = await openMic();
    if (!stream) return send({ type: 'blocked' });
    try {
      rec.current = new Recording(stream);
    } catch (error) {
      for (const t of stream.getTracks()) t.stop();
      console.error('Briefkord: could not start recording', error);
      return send({ type: 'blocked' });
    }
    provider.current = p;
    const at = Date.now();
    setNow(at);
    send({ type: 'listen', at });
  };

  const write = async () => {
    const r = rec.current;
    const p = provider.current;
    rec.current = undefined;
    if (!r || !p) return send({ type: 'reset' });
    const c = new AbortController();
    ctrl.current = c;
    try {
      const audio = await r.stop();
      const key = await aiKey(p);
      if (!key) return send({ type: 'no-key' });
      const model = await speechModel(p, key);
      const words = await transcribe(p, key, model, audio, { signal: c.signal });
      if (c.signal.aborted) return;
      put(words);
      send({ type: 'reset' });
    } catch (error) {
      if (c.signal.aborted) return;
      if (!(error instanceof SpeechError)) console.error('Briefkord: could not write down the speech', error);
      send({ type: 'fail', why: error instanceof SpeechError ? error.why : 'failed', provider: p });
    }
  };

  /** Into the field at its cursor, through the browser's own editing so the field's Undo removes it in one go. */
  const put = (words: string) => {
    const el = field.current;
    if (!el?.isConnected) return;
    const r = insertWords(el.value, el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, words);
    if (!r) return;
    el.focus();
    el.setSelectionRange(r.start, r.end);
    if (!document.execCommand('insertText', false, r.text)) {
      el.setRangeText(r.text, r.start, r.end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    setTint({ from: r.from, to: r.to });
    live.current.onInserted?.(el.value);
  };

  // Called from a click: Chrome's site prompt goes first, before any await.
  const press = () => {
    const action = pressAction(phase);
    if (action === 'stop') {
      send({ type: 'stop' });
      void write();
      return;
    }
    if (action !== 'start') return;
    const names = keys.names.current;
    const p = names && speechProvider(names);
    if (!p) {
      if (names) return send({ type: 'no-key' });
      send({ type: 'ask' });
      void loadedKeyNames()
        .then((list) => {
          keys.names.current = list;
          const q = speechProvider(list);
          if (!q) return send({ type: 'no-key' });
          return listen(q, hasHostAccess(q));
        })
        .catch((error: unknown) => {
          console.error('Briefkord: could not load the speech key', error);
          send({ type: 'reset' });
        });
      return;
    }
    const asked = keys.host.current[p] ? Promise.resolve(true) : requestHostAccess(p);
    send({ type: 'ask' });
    void listen(p, asked).catch((error: unknown) => {
      console.error('Briefkord: could not open the microphone', error);
      send({ type: 'blocked' });
    });
  };

  // Keeps the cursor in the field while the mic is pressed, and the canvas from taking the press.
  const hold = {
    onMouseDown: (e: MouseEvent) => e.preventDefault(),
    onPointerDown: (e: PointerEvent) => e.stopPropagation(),
  };

  const micButton = (
    <span className="bk-dict-mic">
      <span role="tooltip" className="bk-dict-tip">Speak instead of typing</span>
      <button type="button" className="bk-dict-btn" aria-label="Speak instead of typing" disabled={phase.kind === 'writing'} aria-busy={phase.kind === 'asking' || undefined} onClick={press} {...hold}>
        <MicIcon />
      </button>
    </span>
  );

  let controls: ReactNode;
  if (phase.kind === 'listening') {
    controls = (
      <>
        <span aria-hidden="true" className="bk-dict-bars">
          {levels.map((h, i) => <span key={i} style={{ height: h }} />)}
        </span>
        <span className="bk-dict-clock">{clock(now - phase.since)}</span>
        <span className="bk-dict-gap" />
        <button type="button" className="bk-dict-stop" aria-label="Stop speaking" aria-pressed="true" onClick={press} {...hold}><StopIcon /></button>
      </>
    );
  } else if (phase.kind === 'writing') {
    controls = (
      <>
        <Spinner />
        <span role="status" className="bk-dict-writing">Writing it down…</span>
        <span className="bk-dict-gap" />
        {micButton}
      </>
    );
  } else {
    controls = (
      <>
        <span className="bk-dict-gap" />
        {micButton}
      </>
    );
  }

  const below = belowFor(phase, { onAddKey, retry: press });
  const el = field.current;
  const tinted = tint && el ? <Tint field={el} from={tint.from} to={tint.to} /> : null;
  /** Another card took the panel: the mic stops and its audio is thrown away. */
  const cancel = () => {
    discard();
    send({ type: 'reset' });
    setTint(undefined);
  };
  return { phase, controls, below, tint: tinted, cancel };
}

const nameOf = (p: string): string => (p in PROVIDERS ? PROVIDERS[p as SpeechProvider].label : p);

function belowFor(phase: DictatePhase, { onAddKey, retry }: { onAddKey(): void; retry(): void }): ReactNode {
  switch (phase.kind) {
    case 'listening':
      return <span role="status" className="bk-dict-status">Listening… Press again to stop.</span>;
    case 'no-key':
      return (
        <div role="status" className="bk-dict-nokey">
          <KeyIcon />
          <span className="bk-dict-grow">Add a Groq or OpenAI key to speak</span>
          <button type="button" className="bk-dict-link" onClick={onAddKey}>Add a key</button>
        </div>
      );
    case 'blocked':
      return (
        <div role="alert" className="bk-dict-alert">
          <span className="bk-dict-alert-line"><WarnIcon /><span>Briefkord can’t use the microphone. Allow it in Chrome’s site settings, then try again.</span></span>
          <button type="button" className="bk-dict-alert-btn" onClick={() => void browser.tabs.create({ url: micSettingsUrl() })}>Open settings</button>
        </div>
      );
    case 'failed': {
      const name = nameOf(phase.provider);
      const title = phase.why === 'key' ? `${name} refused the key` : phase.why === 'site' ? `Briefkord can’t reach ${name} yet` : `${name} isn’t answering`;
      return (
        <div role="alert" className="bk-dict-alert">
          <span className="bk-dict-alert-line"><WarnIcon /><span>{title}</span></span>
          {phase.why === 'site' && <button type="button" className="bk-dict-alert-btn" onClick={retry}>Ask Chrome again</button>}
          {phase.why === 'key' && <button type="button" className="bk-dict-alert-btn" onClick={onAddKey}>{`Check the ${name} key`}</button>}
        </div>
      );
    }
    default:
      return null;
  }
}

