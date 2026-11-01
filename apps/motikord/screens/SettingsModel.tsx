import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { HOSTS, requestHost } from '../lib/hostAccess';
import { checkModel, FALLBACK_MODEL, listModels, LLMError, type LLMErrorCode } from '../lib/llm';
import { PROVIDERS, SUGGESTED_MODELS, withArticle } from '../lib/providers';
import type { Provider } from '../lib/types';
import { ProviderAccess } from './StatesSetup';

const label = (p: Provider) => PROVIDERS[p].label;
const s: CSSProperties = { fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 };
const btn1: CSSProperties = { height: 32, padding: '0 12px', border: 0, borderRadius: 9, background: 'var(--ink)', color: '#fff', font: '600 12px var(--font)', cursor: 'pointer', flexShrink: 0, textDecoration: 'none', display: 'flex', alignItems: 'center' };
const btn2: CSSProperties = { ...btn1, border: '1px solid #E0E0E4', background: 'var(--surface)', color: 'var(--ink)' };
const tag = (grey: boolean): CSSProperties => ({ font: '600 10px var(--font)', padding: '2px 7px', borderRadius: 999, background: grey ? '#F1F1F3' : 'var(--tint-strong)', color: grey ? 'var(--muted)' : 'var(--accent-hover)', flexShrink: 0 });

const icon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, style: { flexShrink: 0, marginTop: 1 } };
const Spin = () => <svg {...icon} stroke="var(--accent)" strokeWidth="2.4" style={{ flexShrink: 0, animation: 'spin 0.8s linear infinite' }}><path d="M12 3a9 9 0 1 0 9 9" /></svg>;
const Tick = () => <svg {...icon} stroke="var(--success-ink)" strokeWidth="2.4" style={{ flexShrink: 0 }}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const Info = () => <svg {...icon} stroke="var(--muted)" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></svg>;
const Lock = () => <svg {...icon} stroke="var(--muted)" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
const Warn = () => <svg {...icon} stroke="#B45309" strokeWidth="2"><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5v.01" /></svg>;
const Cross = () => <svg {...icon} stroke="var(--error-ink)" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>;
const Chevron = ({ up }: { up?: boolean }) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} /></svg>;

function Note({ bg, center, children, role }: { bg: string; center?: boolean; children: ReactNode; role?: 'status' | 'alert' }) {
  return <div role={role} style={{ display: 'flex', gap: 10, alignItems: center ? 'center' : 'flex-start', padding: '10px 12px', borderRadius: 10, background: bg }}>{children}</div>;
}
function Titled({ title, children }: { title: string; children: string }) {
  return <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}><span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span><span style={s}>{children}</span></span>;
}

export function ModelListLoading({ provider }: { provider: Provider }) {
  return <span role="status" style={s}>{`Getting ${label(provider)}’s list… You can keep typing.`}</span>;
}
/** A grey note, not a warning: the suggestions and any typed name still work. */
export function ModelListFailed({ provider, onTryAgain }: { provider: Provider; onTryAgain?: () => void }) {
  return (
    <Note bg="var(--ground)"><Info /><span style={{ ...s, flexGrow: 1 }}>{`${label(provider)}’s full list didn’t load, so the suggestions show instead. You can still type any model name.`}</span>
      <button type="button" onClick={onTryAgain} style={btn2}>Try again</button></Note>
  );
}
export function ModelTyped({ onCheck }: { onCheck?: () => void }) {
  return <Note bg="var(--ground)" center><span style={{ ...s, flexGrow: 1 }}>Not in the list. Check it once to be sure.</span><button type="button" onClick={onCheck} style={btn2}>Check model</button></Note>;
}
export function ModelChecking({ model }: { model: string }) {
  return <Note bg="var(--ground)" center role="status"><Spin /><span style={{ ...s, flexGrow: 1 }}>{`Asking ${model} a test question…`}</span></Note>;
}
export const seconds = (ms: number) => (Math.max(ms, 100) / 1000).toFixed(1);
export function ModelCheckOk({ model, ms, onCheck }: { model: string; ms: number; onCheck?: () => void }) {
  return (
    <Note bg="var(--success-bg)" center role="status"><Tick /><span style={{ ...s, flexGrow: 1, color: 'var(--ink)' }}>{`${model} answered in ${seconds(ms)} s. Ready for clips.`}</span>
      {onCheck && <button type="button" onClick={onCheck} style={btn2}>Check model</button>}</Note>
  );
}
/** model-check-key-refused / -offline / -busy / -server-error: one line, warning unless the key itself was refused. */
export type CheckProblem = 'key-refused' | 'offline' | 'busy' | 'server-error';
export const checkProblemFor = (code: LLMErrorCode): CheckProblem =>
  code === 'auth' ? 'key-refused' : code === 'offline' ? 'offline' : code === 'rate-limited' ? 'busy' : 'server-error';
export function modelCheckProblemLine(problem: CheckProblem, provider: Provider, model: string): string {
  const p = label(provider);
  if (problem === 'key-refused') return `${p} refused the key. Check it in Paste a key.`;
  if (problem === 'offline') return `Couldn’t reach ${p}. Check your connection, then check ${model} again.`;
  if (problem === 'busy') return `${p} is busy. Try ${model} again in a moment.`;
  return `${p} had a problem on its side. Try ${model} again soon.`;
}
export function ModelCheckProblem({ problem, provider, model, onCheck }: { problem: CheckProblem; provider: Provider; model: string; onCheck?: () => void }) {
  const refused = problem === 'key-refused';
  return (
    <Note bg={refused ? 'var(--error-bg)' : 'var(--warning-bg)'} center role="alert">{refused ? <Cross /> : <Warn />}
      <span style={{ ...s, flexGrow: 1, color: 'var(--ink)' }}>{modelCheckProblemLine(problem, provider, model)}</span>
      {!refused && <button type="button" onClick={onCheck} style={btn2}>Check model</button>}</Note>
  );
}
export function ModelNotFound({ provider, model, previous, onUsePrevious, onShowModels }: { provider: Provider; model: string; previous: string; onUsePrevious?: () => void; onShowModels?: () => void }) {
  return (
    <>
      <Note bg="var(--error-bg)" role="alert"><Cross /><Titled title={`${label(provider)} doesn’t have ${model}`}>{`Check the spelling, or pick a suggested model. Motikord keeps using ${previous} until this one works.`}</Titled></Note>
      <div style={{ display: 'flex', gap: 8 }}><button type="button" onClick={onUsePrevious} style={btn1}>{`Use ${previous}`}</button><button type="button" onClick={onShowModels} style={btn2}>Show models</button></div>
    </>
  );
}
export function ModelNotForText({ provider, model }: { provider: Provider; model: string }) {
  return <Note bg="var(--warning-bg)" role="alert"><Warn /><Titled title={`${model} can’t write clips`}>{`It works with sound, not text. Pick a chat model like ${SUGGESTED_MODELS[provider].models[0]}.`}</Titled></Note>;
}
export function ModelNeedsKey({ provider, onPaste, onPenv }: { provider: Provider; onPaste?: () => void; onPenv?: () => void }) {
  return (
    <>
      <Note bg="var(--ground)"><Lock /><Titled title={`Add ${withArticle(label(provider))} key to use it`}>You can choose a model now. Clips start once a key works.</Titled></Note>
      <div style={{ display: 'flex', gap: 8 }}><button type="button" onClick={onPaste} style={btn1}>Paste a key</button><button type="button" onClick={onPenv} style={btn2}>Use Penv Cloud</button></div>
    </>
  );
}
export function ModelBuiltIn() {
  return <span style={s}>Chrome picks its own built-in model. There’s nothing to choose.</span>;
}

type FieldLook = 'plain' | 'focus' | 'bad';
const FIELD: Record<FieldLook, CSSProperties> = {
  plain: { border: '1px solid #E0E0E4' },
  focus: { border: '1.5px solid var(--accent)', boxShadow: '0 0 0 3px var(--tint-strong)' },
  bad: { border: '1.5px solid #DC2626' },
};

/** The picker list: "Suggested", then "From {provider}", then the typed name as typed. */
export function ModelOptions({ provider, live, query, chosen, onPick }: { provider: Provider; live: string[]; query: string; chosen: string; onPick: (m: string) => void }) {
  const { models: suggested, faster } = SUGGESTED_MODELS[provider];
  const q = query.trim().toLowerCase();
  const match = (m: string) => !q || m.toLowerCase().includes(q);
  const sugg = suggested.filter(match);
  const from = live.filter((m) => !suggested.includes(m) && match(m));
  const exact = query.trim() && ![...suggested, ...live].includes(query.trim());
  const grp: CSSProperties = { padding: '6px 8px 4px', font: '10px var(--mono)', color: 'var(--faint)', textTransform: 'uppercase', letterSpacing: '.04em' };
  const opt = (m: string, extra?: ReactNode) => (
    <div key={m} role="option" aria-selected={m === chosen} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(m)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 8, borderRadius: 8, font: '12px var(--mono)', cursor: 'pointer', background: m === chosen ? 'var(--tint)' : undefined, overflowWrap: 'anywhere' }}>
      {m}<span style={{ flexGrow: 1 }} />{extra}
    </div>
  );
  return (
    <div role="listbox" aria-label="Model" style={{ border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface)', boxShadow: '0 10px 28px rgba(16,16,20,0.12)', display: 'flex', flexDirection: 'column', padding: 6, marginTop: 2, maxHeight: 280, overflowY: 'auto' }}>
      {sugg.length > 0 && <span style={grp}>Suggested</span>}
      {sugg.map((m) => opt(m, m === suggested[0] ? <span style={tag(false)}>Recommended</span> : m === faster ? <span style={tag(true)}>Faster</span> : undefined))}
      {from.length > 0 && <span style={grp}>{`From ${label(provider)}`}</span>}
      {from.map((m) => opt(m))}
      {exact && (
        <>
          <div style={{ height: 1, background: '#EFEFF1', margin: '4px 0' }} />
          <div role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(query.trim())}
            style={{ padding: 8, borderRadius: 8, font: '500 12px var(--font)', color: 'var(--accent)', cursor: 'pointer' }}>{`Use “${query.trim()}” as typed`}</div>
        </>
      )}
    </div>
  );
}

/** The Model combobox shell: a free text field in mono, an optional tag, and the chevron (or a spinner while the list loads). */
export function ModelInput({ value, look = 'plain', yours, busy, open, onChange, onKeyDown, onBlur, onToggle, hideChevron }: {
  value: string; look?: FieldLook; yours?: boolean; busy?: boolean; open?: boolean; hideChevron?: boolean;
  onChange?: (v: string) => void; onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void; onBlur?: () => void; onToggle?: () => void;
}) {
  return (
    <div role="combobox" aria-expanded={!!open} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 10px 0 12px', borderRadius: 10, background: 'var(--surface)', boxSizing: 'border-box', ...FIELD[look] }}>
      <input id="model" aria-label="Model" value={value} spellCheck={false} autoComplete="off" onChange={(e) => onChange?.(e.target.value)} onKeyDown={onKeyDown} onBlur={onBlur} readOnly={!onChange}
        style={{ flexGrow: 1, border: 0, outline: 'none', font: '13px var(--mono)', color: 'var(--ink)', background: 'transparent', minWidth: 0 }} />
      {yours && <span style={tag(true)}>Your choice</span>}
      {!hideChevron && (busy
        ? <span style={{ width: 28, height: 28, display: 'grid', placeItems: 'center' }}><Spin /></span>
        : <button type="button" aria-label="Show models" onMouseDown={(e) => e.preventDefault()} onClick={onToggle} className="icon-btn" style={{ width: 28, height: 28, borderRadius: 7, display: 'grid', placeItems: 'center', color: 'var(--muted)', border: 0, background: 'none', cursor: 'pointer', padding: 0 }}><Chevron up={open} /></button>)}
    </div>
  );
}

type ListState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; models: string[] };
type CheckState = { kind: 'idle' } | { kind: 'checking'; model: string } | { kind: 'ok'; model: string; ms: number }
  | { kind: 'not-found'; model: string; previous: string } | { kind: 'not-for-text'; model: string } | { kind: 'access' } | { kind: 'error'; code: LLMErrorCode };

type Contains = (p: { origins: string[] }) => Promise<boolean>;
/** Whether Settings may load the live list on open: a key, and Chrome already lets Motikord reach the provider. Never prompts. */
export async function listOnOpen(provider: Provider, apiKey: string | undefined, contains: Contains = (p) => browser.permissions.contains(p)): Promise<boolean> {
  if (!apiKey) return false;
  try { return await contains({ origins: [...HOSTS[provider]] }); } catch { return false; }
}

export interface ModelFieldProps {
  provider: Provider;
  saved: string | undefined;          // Settings.models[provider]
  apiKey: string | undefined;
  onSave: (model: string) => void;
  onPasteKey: () => void;
  onPenv: () => void;
}

/** The Settings Model field: any typed name works; the built-in suggestions always show; the live list merges in when it loads. */
export function ModelField({ provider, saved, apiKey, onSave, onPasteKey, onPenv }: ModelFieldProps) {
  const current = saved ?? FALLBACK_MODEL[provider];
  const [value, setValue] = useState(current);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [list, setList] = useState<ListState>({ kind: 'idle' });
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });
  const previous = useRef<string | undefined>(undefined);
  const run = useRef(0);

  useEffect(() => { setValue(current); }, [current]);

  const load = useCallback((access: Promise<unknown>) => {
    if (!apiKey) return;
    const mine = ++run.current;
    setList({ kind: 'loading' });
    access
      .then(() => listModels(provider, apiKey))
      .then((l) => { if (mine === run.current) setList({ kind: 'ready', models: l.models }); })
      .catch(() => { if (mine === run.current) setList({ kind: 'failed' }); });
  }, [provider, apiKey]);

  // Without the provider's host Chrome blocks the request, so the list waits for a click instead of failing.
  useEffect(() => {
    let live = true;
    void listOnOpen(provider, apiKey).then((ok) => { if (live && ok) load(Promise.resolve()); });
    return () => { live = false; };
  }, [provider, apiKey, load]);

  // Inside a click: ask Chrome for the host before anything is awaited, then load the list if it isn't there yet.
  const access = () => {
    const asked = requestHost(HOSTS[provider]);
    if (apiKey && (list.kind === 'idle' || list.kind === 'failed')) load(asked);
    return asked;
  };

  const live = list.kind === 'ready' ? list.models : [];
  const known = [...SUGGESTED_MODELS[provider].models, ...live];
  const commit = (m: string) => {
    const next = m.trim();
    setOpen(false); setTyped(false);
    if (!next) { setValue(current); return; }
    setValue(next);
    if (next !== current) { previous.current = current; setCheck({ kind: 'idle' }); onSave(next); }
  };

  const runCheck = () => {
    if (!apiKey) return;
    const model = value.trim() || current;
    const asked = access();
    if (model !== current) commit(model);
    setCheck({ kind: 'checking', model });
    void asked.then((a) => {
      if (a === 'denied') { setCheck({ kind: 'access' }); return; }
      return checkModel(provider, model, apiKey).then(
        (ms) => setCheck({ kind: 'ok', model, ms }),
        (error: unknown) => {
          const code: LLMErrorCode = error instanceof LLMError ? error.code : 'server';
          const before = previous.current && previous.current !== model ? previous.current : SUGGESTED_MODELS[provider].models.find((x) => x !== model)!;
          // Clips keep using the model before this one until the new one answers.
          if (code === 'model-not-found' || code === 'not-for-text') onSave(before);
          if (code === 'model-not-found') setCheck({ kind: 'not-found', model, previous: before });
          else if (code === 'not-for-text') setCheck({ kind: 'not-for-text', model });
          else setCheck({ kind: 'error', code });
        },
      );
    });
  };

  const usePrevious = (m: string) => { previous.current = undefined; setCheck({ kind: 'idle' }); setValue(m); onSave(m); };
  const toggle = () => { if (!open) access(); setOpen(!open); setTyped(false); };
  const shown = check.kind === 'not-found' || check.kind === 'not-for-text' ? check.model : value;
  const yours = !open && check.kind !== 'not-found' && !known.includes(shown);

  let result: ReactNode;
  if (!apiKey) result = <ModelNeedsKey provider={provider} onPaste={onPasteKey} onPenv={onPenv} />;
  else if (check.kind === 'checking') result = <ModelChecking model={check.model} />;
  else if (check.kind === 'ok') result = <ModelCheckOk model={check.model} ms={check.ms} onCheck={runCheck} />;
  else if (check.kind === 'not-found') result = <ModelNotFound provider={provider} model={check.model} previous={check.previous} onUsePrevious={() => usePrevious(check.previous)} onShowModels={() => { access(); setOpen(true); }} />;
  else if (check.kind === 'not-for-text') result = <ModelNotForText provider={provider} model={check.model} />;
  else if (check.kind === 'access') result = <ProviderAccess provider={provider} onAllow={runCheck} />;
  else if (check.kind === 'error') result = <ModelCheckProblem problem={checkProblemFor(check.code)} provider={provider} model={value.trim() || current} onCheck={runCheck} />;
  else if (yours) result = <ModelTyped onCheck={runCheck} />;
  else result = <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" onClick={runCheck} style={btn2}>Check model</button></div>;

  return (
    <div data-frame="SettingsModel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label htmlFor="model" style={{ fontSize: 13, fontWeight: 600 }}>Model</label>
      <ModelInput value={shown} open={open} yours={yours} busy={list.kind === 'loading'} hideChevron={check.kind === 'checking'}
        look={check.kind === 'not-found' ? 'bad' : open ? 'focus' : 'plain'}
        onChange={(v) => { setValue(v); setOpen(true); setTyped(true); if (check.kind !== 'idle' && check.kind !== 'ok') setCheck({ kind: 'idle' }); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(value); } else if (e.key === 'Escape') { setOpen(false); setValue(current); } }}
        onBlur={() => { if (typed) commit(value); else setOpen(false); }}
        onToggle={toggle} />
      {open && <ModelOptions provider={provider} live={live} query={typed ? value : ''} chosen={current} onPick={commit} />}
      {open ? <span style={s}>Typing filters the list. Enter uses exactly what you typed.</span> : <span style={s}>{`Type any model name ${label(provider)} offers, or pick one.`}</span>}
      {list.kind === 'loading' && <ModelListLoading provider={provider} />}
      {list.kind === 'failed' && <ModelListFailed provider={provider} onTryAgain={() => load(requestHost(HOSTS[provider]))} />}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span style={{ ...s, marginRight: 2 }}>Suggested</span>
        {SUGGESTED_MODELS[provider].models.map((m) => (
          <button key={m} type="button" aria-pressed={m === current} onClick={() => commit(m)}
            style={{ height: 28, padding: '0 10px', borderRadius: 999, border: `1px solid ${m === current ? 'var(--accent)' : '#E0E0E4'}`, background: m === current ? 'var(--tint)' : 'var(--surface)', font: '11px var(--mono)', color: m === current ? 'var(--accent-hover)' : 'var(--ink)', cursor: 'pointer' }}>{m}</button>
        ))}
      </div>
      {result}
      <span style={s}>Large, strong models write the best clips. Small ones are faster but simpler.</span>
    </div>
  );
}

const SHEET: [string, ReactNode][] = [
  ['model-picker-open · Settings (Model)', <><ModelInput value="gpt-4" look="focus" open /><ModelOptions provider="openai" live={['gpt-4o', 'gpt-4o-mini', 'gpt-4.1-nano']} query="gpt-4" chosen="gpt-4.1" onPick={() => undefined} /><span style={s}>Typing filters the list. Enter uses exactly what you typed.</span></>],
  ['model-list-loading · Settings (Model)', <><ModelInput value="gpt-4.1" busy /><ModelListLoading provider="openai" /></>],
  ['model-list-failed · Settings (Model)', <><ModelInput value="gpt-4.1" /><ModelListFailed provider="openai" /></>],
  ['model-typed · Settings (Model, a name not in the list)', <><ModelInput value="gpt-4o-2024-11-20" yours /><ModelTyped /></>],
  ['model-checking · Settings (Model)', <><ModelInput value="gpt-4o-2024-11-20" yours hideChevron /><ModelChecking model="gpt-4o-2024-11-20" /></>],
  ['model-check-ok · Settings (Model)', <ModelCheckOk model="gpt-4o-2024-11-20" ms={1400} />],
  ['model-check-key-refused · Settings (Model)', <ModelCheckProblem problem="key-refused" provider="openai" model="gpt-4.1" />],
  ['model-check-offline · Settings (Model)', <ModelCheckProblem problem="offline" provider="openai" model="gpt-4.1" />],
  ['model-check-busy · Settings (Model)', <ModelCheckProblem problem="busy" provider="openai" model="gpt-4.1" />],
  ['model-check-server-error · Settings (Model)', <ModelCheckProblem problem="server-error" provider="openai" model="gpt-4.1" />],
  ['model-not-found · Settings (Model), Making your clip', <><ModelInput value="gpt-4o-maxi" look="bad" hideChevron /><ModelNotFound provider="openai" model="gpt-4o-maxi" previous="gpt-4.1" /></>],
  ['model-not-for-text · Settings (Model)', <ModelNotForText provider="openai" model="whisper-1" />],
  ['model-needs-key · Settings (Model)', <><ModelInput value="claude-sonnet-4-5" /><ModelNeedsKey provider="anthropic" /></>],
  ['model-built-in · Settings (On this computer chosen)', <ModelBuiltIn />],
];

/** Every Model field state on one sheet. */
export default function SettingsModel() {
  return (
    <main data-frame="SettingsModel" style={{ padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {SHEET.map(([name, body]) => (
        <section key={name} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 className="mono" style={{ margin: 0, padding: '0 4px', fontSize: 11, fontWeight: 500, color: 'var(--faint)' }}>{name}</h2>
          <div style={{ padding: 14, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {name.startsWith('model-check-') || name.startsWith('model-not-') ? null : <span style={{ fontSize: 13, fontWeight: 600 }}>Model</span>}
            {body}
          </div>
        </section>
      ))}
    </main>
  );
}
