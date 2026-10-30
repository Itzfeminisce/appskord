import { useEffect, useRef, useState } from 'react';
import { toAiError } from '../../lib/ai/errors';
import { applyPrompt, rebase } from '../../lib/editor/applyPrompt';
import { HOSTS, requestHost, type HostAccess } from '../../lib/hostAccess';
import { getSettings, onSettingsChanged } from '../../lib/settings';
import { openSidePanelOn } from '../../lib/sidepanelGo';
import type { AiMode } from '../../lib/types';
import Editor, { useEditor } from './Editor';
import { ChangeTooLong, GroqAccess, GroqBusy, GroqBusyRetried, GroqDown, Offline, PromptFailed, PromptWorking } from './StatesPrompt';

// Editor frame, centre: "Tell Motikord what to change" with its chips. EditorPrompt frame: the "Done." toast with Undo.

const CHIPS = ['Slower', 'Bigger title', 'Use my brand colours', 'Swap scene 2 and 3'];
const BUSY_S = 20;

type Ui =
  | { kind: 'idle' } | { kind: 'working' } | { kind: 'failed' } | { kind: 'too-long'; totalMs: number }
  | { kind: 'busy'; left: number } | { kind: 'busy-retried' } | { kind: 'down' } | { kind: 'offline' } | { kind: 'access' };

export function PromptBox() {
  const { state, edit, toast } = useEditor();
  const [text, setText] = useState('');
  const [ui, setUi] = useState<Ui>({ kind: 'idle' });
  const last = useRef('');
  const ai = useRef<AiMode>('cloud');
  const windowId = useRef<number>(undefined);
  const stop = useRef<AbortController>(undefined);
  // Set from the click until the run ends, so a second send while Chrome asks for access starts nothing.
  const busy = useRef(false);
  // groq-busy retries by itself once per prompt; a send by the user starts the count again.
  const retried = useRef(false);
  const recipe = useRef(state.clip.recipe);
  recipe.current = state.clip.recipe;

  useEffect(() => {
    void getSettings().then((s) => { ai.current = s.ai; }).catch(() => undefined);
    // Known before any click, so "Open Settings" can open the side panel inside the click.
    void browser.windows.getCurrent().then((w) => { windowId.current = w.id; }).catch(() => undefined);
    const off = onSettingsChanged((s) => { ai.current = s.ai; });
    const online = () => setUi((u) => (u.kind === 'offline' ? { kind: 'idle' } : u));
    window.addEventListener('online', online);
    return () => { off(); window.removeEventListener('online', online); stop.current?.abort(); };
  }, []);

  const run = async (prompt: string, access: Promise<HostAccess>) => {
    busy.current = true;
    const ac = new AbortController();
    try {
      if ((await access) === 'denied') { setUi({ kind: 'access' }); return; }
      if (ai.current === 'cloud' && !navigator.onLine) { setUi({ kind: 'offline' }); return; }
      stop.current = ac;
      setUi({ kind: 'working' });
      const from = recipe.current;
      const answer = await applyPrompt(from, prompt, { signal: ac.signal });
      // The clip may have been edited by hand meanwhile: re-check the answer against the clip as it is now.
      const out = rebase(answer, prompt, from, recipe.current);
      if (!out || !edit(out.edit, { by: out.by })) { setUi({ kind: 'failed' }); return; }
      toast(out.detail ? `Done. ${out.detail}` : 'Done.');
      setText('');
      setUi({ kind: 'idle' });
    } catch (error) {
      const e = toAiError(error, 'edit');
      if (e.code !== 'cancelled') console.error('Motikord: could not change the clip', e);
      switch (e.state) {
        case undefined: setUi({ kind: 'idle' }); break;
        case 'change-too-long': setUi({ kind: 'too-long', totalMs: e.detail.totalMs ?? 0 }); break;
        case 'groq-busy': setUi(retried.current ? { kind: 'busy-retried' } : { kind: 'busy', left: Math.max(1, Math.ceil((e.detail.retryAfterMs ?? BUSY_S * 1000) / 1000)) }); break;
        case 'groq-down': setUi({ kind: 'down' }); break;
        case 'offline': setUi({ kind: 'offline' }); break;
        default: setUi({ kind: 'failed' });
      }
    } finally {
      busy.current = false;
      if (stop.current === ac) stop.current = undefined;
    }
  };

  /** Call from a click or Enter: host access is asked before anything is awaited, so Chrome shows its prompt. */
  const send = (words: string) => {
    const prompt = words.trim();
    if (!prompt || busy.current) return;
    busy.current = true;
    retried.current = false;
    const access: Promise<HostAccess> = ai.current === 'cloud' ? requestHost(HOSTS.groq) : Promise.resolve('granted');
    last.current = prompt;
    void run(prompt, access);
  };

  // groq-busy counts down and tries again by itself, once; Groq was reachable, so no new host prompt is needed.
  useEffect(() => {
    if (ui.kind !== 'busy') return;
    const id = setTimeout(() => {
      if (ui.left <= 1) { retried.current = true; void run(last.current, Promise.resolve('granted')); }
      else setUi({ kind: 'busy', left: ui.left - 1 });
    }, 1000);
    return () => clearTimeout(id);
  }, [ui]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSettings = () => {
    const id = windowId.current;
    if (id === undefined) return;
    openSidePanelOn(id, 'Settings');
  };

  const card = (() => {
    switch (ui.kind) {
      case 'failed': return <PromptFailed onRetry={() => send(last.current)} />;
      case 'too-long': return <ChangeTooLong totalMs={ui.totalMs} />;
      case 'busy': return <GroqBusy seconds={ui.left} onTryNow={() => send(last.current)} />;
      case 'busy-retried': return <GroqBusyRetried onTryNow={() => send(last.current)} />;
      case 'down': return <GroqDown onOpenSettings={openSettings} />;
      case 'offline': return <Offline />;
      case 'access': return <GroqAccess onAllow={() => send(last.current)} />;
      default: return null;
    }
  })();

  return (
    <div style={{ position: 'relative', width: '100%', maxWidth: 620, display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
      {card && <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'calc(100% + 8px)', zIndex: 7 }}>{card}</div>}
      {ui.kind === 'working'
        ? <PromptWorking onStop={() => stop.current?.abort()} />
        : (
          <form onSubmit={(e) => { e.preventDefault(); send(text); }}
            style={{ height: 46, boxSizing: 'border-box', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line-strong)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 6px 0 14px', boxShadow: '0 2px 8px rgba(16,16,20,0.06)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
            <input aria-label="Tell Motikord what to change" placeholder="Tell Motikord what to change" value={text}
              onChange={(e) => { setText(e.target.value); if (ui.kind !== 'idle' && ui.kind !== 'offline') setUi({ kind: 'idle' }); }}
              style={{ flexGrow: 1, minWidth: 0, border: 0, outline: 'none', font: '14px/1 var(--font)', color: 'var(--ink)', background: 'transparent' }} />
            <button type="submit" aria-label="Send" disabled={!text.trim()}
              style={{ width: 34, height: 34, border: 0, borderRadius: 10, background: 'var(--accent)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer', opacity: text.trim() ? 1 : 0.6 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" /></svg>
            </button>
          </form>
        )}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
        {CHIPS.map((c) => (
          <button key={c} type="button" disabled={ui.kind === 'working'} onClick={() => { setText(c); send(c); }}
            style={{ height: 26, padding: '0 10px', borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--line-strong)', color: 'var(--ink)', font: '12px/1 var(--font)', display: 'flex', alignItems: 'center', cursor: 'pointer' }}>{c}</button>
        ))}
      </div>
    </div>
  );
}

/** Route screen (dev `?screen=EditorPrompt`): the editor with the Changes tab open. */
export default function EditorPrompt() {
  return <Editor open="changes" />;
}
