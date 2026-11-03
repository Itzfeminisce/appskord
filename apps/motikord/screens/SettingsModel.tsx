import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { PickerList } from '@appskord/llm';
import { ModelPicker, type PickerGroup, type PickerOption, type PickerValue } from '@appskord/ui';
import { HOSTS, requestHost, type HostAccess } from '../lib/hostAccess';
import { checkModel, listModels, LLMError, type LLMErrorCode } from '../lib/llm';
import { pickedModel, PROVIDERS, SUGGESTED_MODELS, withArticle } from '../lib/providers';
import type { SettingsPatch } from '../lib/settings';
import type { Provider, Settings } from '../lib/types';
import { ProviderAccess } from './StatesSetup';

const label = (p: Provider) => PROVIDERS[p].label;
const s: CSSProperties = { fontSize: 12, color: 'var(--muted)', lineHeight: 1.45 };
const btn1: CSSProperties = { height: 32, padding: '0 12px', border: 0, borderRadius: 9, background: 'var(--ink)', color: '#fff', font: '600 12px var(--font)', cursor: 'pointer', flexShrink: 0, textDecoration: 'none', display: 'flex', alignItems: 'center' };
const btn2: CSSProperties = { ...btn1, border: '1px solid #E0E0E4', background: 'var(--surface)', color: 'var(--ink)' };

const icon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, style: { flexShrink: 0, marginTop: 1 } };
const Spin = () => <svg {...icon} stroke="var(--accent)" strokeWidth="2.4" style={{ flexShrink: 0, animation: 'spin 0.8s linear infinite' }}><path d="M12 3a9 9 0 1 0 9 9" /></svg>;
const Lock = () => <svg {...icon} stroke="var(--muted)" strokeWidth="2"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
const Warn = () => <svg {...icon} stroke="#B45309" strokeWidth="2"><path d="M12 3.5l9.5 16.5h-19z" /><path d="M12 10v4.5M12 17.5v.01" /></svg>;
const Cross = () => <svg {...icon} stroke="var(--error-ink)" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>;

function Note({ bg, center, children, role }: { bg: string; center?: boolean; children: ReactNode; role?: 'status' | 'alert' }) {
  return <div role={role} style={{ display: 'flex', gap: 10, alignItems: center ? 'center' : 'flex-start', padding: '10px 12px', borderRadius: 10, background: bg }}>{children}</div>;
}
function Titled({ title, children }: { title: string; children: string }) {
  return <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}><span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span><span style={s}>{children}</span></span>;
}

export function ModelChecking({ model }: { model: string }) {
  return <Note bg="var(--ground)" center role="status"><Spin /><span style={{ ...s, flexGrow: 1 }}>{`Asking ${model} a test question…`}</span></Note>;
}
export const seconds = (ms: number) => (Math.max(ms, 100) / 1000).toFixed(1);
const link: CSSProperties = { border: 0, background: 'none', padding: 0, font: '500 13px var(--font)', color: 'var(--accent)', cursor: 'pointer', flexShrink: 0 };
/** The check line under the picker: a green dot once the model answered, and "Check model". */
export function ModelCheckOk({ model, ms, onCheck }: { model: string; ms: number; onCheck?: () => void }) {
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}><span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--success-ink)', flexShrink: 0 }} />
      <span style={{ flex: 1, color: '#44464D', minWidth: 0, overflowWrap: 'anywhere' }}>{`${model} answered in ${seconds(ms)} s. Ready for clips.`}</span>
      {onCheck && <button type="button" onClick={onCheck} style={link}>Check model</button>}</div>
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

type Contains = (p: { origins: string[] }) => Promise<boolean>;
/** Whether Settings may load the live list on open: a key, and Chrome already lets Motikord reach the provider. Never prompts. */
export async function listOnOpen(provider: Provider, apiKey: string | undefined, contains: Contains = (p) => browser.permissions.contains(p)): Promise<boolean> {
  if (!apiKey) return false;
  try { return await contains({ origins: [...HOSTS[provider]] }); } catch { return false; }
}

// ---- The Model picker ----

export const PICKER_FOOT = 'Each list comes from the provider, using your key. “Sees images” models also run the visual critic.';
/** Motikord lists OpenAI first and "On this computer" last. */
export const PICKER_ORDER: Provider[] = ['openai', 'groq', 'anthropic', 'google', 'xai', 'openrouter'];
const ALIASES: Partial<Record<Provider, string[]>> = { anthropic: ['claude'], google: ['google'], xai: ['grok'] };
export const LOCAL = 'local';
export const BUILTIN = 'builtin';

/** A provider's list in the picker: being fetched, or fetched (live, or suggested with the error). */
export type ListState = { status: 'loading' } | { status: 'done'; list: PickerList };
type Choice = Pick<Settings, 'ai' | 'provider' | 'models'>;

/** The picker's value for the saved choice, and the retired model it replaced (picker-model-gone). */
export function pickerValue(s: Choice): { value: PickerValue; gone?: string } {
  if (s.ai === 'local') return { value: { provider: LOCAL, model: BUILTIN } };
  const { model, gone } = pickedModel(s.provider, s.models[s.provider]);
  return { value: { provider: s.provider, model }, gone };
}

/** The settings a picked row saves. */
export function choiceFor(v: PickerValue): SettingsPatch {
  if (v.provider === LOCAL) return { ai: 'local' };
  const p = v.provider as Provider;
  return { ai: 'cloud', provider: p, models: { [p]: v.model } };
}

/** The provider a typed name goes to: the current cloud one, else the first with a key. */
export function typedProviderFor(s: Choice, keys: Record<string, string>): Provider {
  if (s.ai === 'cloud') return s.provider;
  return PICKER_ORDER.find((p) => keys[PROVIDERS[p].keyName]) ?? PICKER_ORDER[0]!;
}

export interface PickerInputs {
  keys: Record<string, string>;          // read for presence only; never shown
  lists: Partial<Record<Provider, ListState>>;
  builtInAi: boolean | null;
}

/** Every group of the picker, in Motikord's order. */
export function pickerGroups(s: Choice, inp: PickerInputs): PickerGroup[] {
  const { value } = pickerValue(s);
  const cloud = PICKER_ORDER.map((p): PickerGroup => {
    const info = PROVIDERS[p];
    const base = { id: p, name: info.label, mark: info.mono, aliases: ALIASES[p], addKeyLabel: `Add ${withArticle(info.label)} key` };
    if (!inp.keys[info.keyName]) return { ...base, status: 'needs-key', models: [] };
    const state = inp.lists[p];
    const list = state?.status === 'done' ? state.list : undefined;
    const models: PickerOption[] = [...(list?.models ?? [])];
    if (value.provider === p && !models.some((m) => m.id === value.model)) models.push({ id: value.model, tag: 'Your choice' });
    if (state?.status === 'loading') return { ...base, status: 'loading', models };
    const code = list?.error?.code;
    if (code === 'auth') return { ...base, status: 'key-refused', models };
    return { ...base, status: code && code !== 'cancelled' ? 'failed' : 'ready', models };
  });
  const builtin = inp.builtInAi !== false || s.ai === 'local';
  const local: PickerGroup = { id: LOCAL, name: 'On this computer', status: 'local', models: builtin ? [{ id: BUILTIN, name: 'Chrome’s built-in AI', tag: 'Simpler clips' }] : [] };
  return [...cloud, local];
}

type CheckState = { kind: 'idle' } | { kind: 'checking'; model: string } | { kind: 'ok'; model: string; ms: number }
  | { kind: 'not-found'; model: string; previous: string } | { kind: 'not-for-text'; model: string } | { kind: 'access'; typed?: string } | { kind: 'error'; code: LLMErrorCode };

export interface ModelSectionProps {
  s: Settings;
  keys: Record<string, string>;
  builtInAi: boolean | null;
  save: (patch: SettingsPatch) => void;
  onKeys: () => void;
  onPasteKey: () => void;
  onPenv: () => void;
}

/** "AI that writes your clips": one Model picker, the check line and the hint. Lists load from each provider when the picker opens. */
export function ModelSection({ s: settings, keys, builtInAi, save, onKeys, onPasteKey, onPenv }: ModelSectionProps) {
  const [lists, setLists] = useState<Partial<Record<Provider, ListState>>>({});
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });
  const run = useRef(0);
  const keyOf = (p: Provider) => keys[PROVIDERS[p].keyName];
  const keyNames = PICKER_ORDER.filter((p) => keyOf(p)).join();
  const { value, gone } = pickerValue(settings);
  const cloud = settings.ai === 'cloud';
  const provider = settings.provider;

  // A key added or removed: its lists load again on the next open.
  useEffect(() => setLists({}), [keyNames]);

  const setList = (p: Provider, state: ListState) => setLists((l) => ({ ...l, [p]: state }));
  const load = (p: Provider, access: Promise<unknown>) => {
    setList(p, { status: 'loading' });
    access
      .then(() => listModels(p, keyOf(p)))
      .then((list) => setList(p, { status: 'done', list }), (error: unknown) => console.error('Motikord: could not load the model list', error));
  };

  // Without the provider's host Chrome blocks the request, so a list loads live only where Motikord may already go; the rest show suggestions.
  const open = () => {
    for (const p of PICKER_ORDER) {
      if (!keyOf(p) || lists[p]) continue;
      setList(p, { status: 'loading' });
      void listOnOpen(p, keyOf(p)).then((ok) => (ok ? load(p, Promise.resolve()) : listModels(p).then((list) => setList(p, { status: 'done', list }))));
    }
  };

  const runCheck = (p: Provider, model: string, previous: string, asked: Promise<HostAccess>) => {
    const key = keyOf(p);
    if (!key) return;
    const mine = ++run.current;
    setCheck({ kind: 'checking', model });
    void asked.then((a) => {
      if (mine !== run.current) return;
      if (a === 'denied') { setCheck({ kind: 'access', typed: model }); return; }
      return checkModel(p, model, key).then(
        (ms) => { if (mine === run.current) setCheck({ kind: 'ok', model, ms }); },
        (error: unknown) => {
          if (mine !== run.current) return;
          const code: LLMErrorCode = error instanceof LLMError ? error.code : 'server';
          // Clips keep using the model before this one until the new one answers.
          if (code === 'model-not-found' || code === 'not-for-text') save({ models: { [p]: previous } });
          if (code === 'model-not-found') setCheck({ kind: 'not-found', model, previous });
          else if (code === 'not-for-text') setCheck({ kind: 'not-for-text', model });
          else setCheck({ kind: 'error', code });
        },
      );
    });
  };

  const pick = (v: PickerValue, typed: boolean) => {
    run.current++;
    setCheck({ kind: 'idle' });
    if (v.provider === LOCAL) { save(choiceFor(v)); return; }
    const p = v.provider as Provider;
    // Asked on the click itself, so Chrome shows its prompt; an allowed host answers at once.
    const asked = requestHost(HOSTS[p]);
    const before = pickedModel(p, settings.models[p]).model;
    const previous = before !== v.model ? before : SUGGESTED_MODELS[p].models.find((m) => m !== v.model)!;
    save(choiceFor(v));
    if (typed) runCheck(p, v.model, previous, asked);
    else void asked.then((a) => { if (a === 'denied') setCheck({ kind: 'access' }); });
  };

  const checkNow = () => runCheck(provider, value.model, SUGGESTED_MODELS[provider].models.find((m) => m !== value.model)!, requestHost(HOSTS[provider]));
  const allow = () => {
    const asked = requestHost(HOSTS[provider]);
    if (check.kind === 'access' && check.typed) runCheck(provider, check.typed, SUGGESTED_MODELS[provider].models.find((m) => m !== check.typed)!, asked);
    else void asked.then((a) => setCheck(a === 'denied' ? { kind: 'access' } : { kind: 'idle' }));
  };
  const usePrevious = (m: string) => { setCheck({ kind: 'idle' }); save({ models: { [provider]: m } }); };

  let result: ReactNode = null;
  if (!cloud) result = null;
  else if (!keyOf(provider)) result = <ModelNeedsKey provider={provider} onPaste={onPasteKey} onPenv={onPenv} />;
  else if (check.kind === 'checking') result = <ModelChecking model={check.model} />;
  else if (check.kind === 'ok') result = <ModelCheckOk model={check.model} ms={check.ms} onCheck={checkNow} />;
  else if (check.kind === 'not-found') result = <ModelNotFound provider={provider} model={check.model} previous={check.previous} onUsePrevious={() => usePrevious(check.previous)} onShowModels={() => setCheck({ kind: 'idle' })} />;
  else if (check.kind === 'not-for-text') result = <ModelNotForText provider={provider} model={check.model} />;
  else if (check.kind === 'access') result = <ProviderAccess provider={provider} onAllow={allow} />;
  else if (check.kind === 'error') result = <ModelCheckProblem problem={checkProblemFor(check.code)} provider={provider} model={value.model} onCheck={checkNow} />;
  else result = <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" onClick={checkNow} style={link}>Check model</button></div>;

  return (
    <>
      <ModelPicker label="Model" foot={PICKER_FOOT} groups={pickerGroups(settings, { keys, lists, builtInAi })} value={value}
        typedProvider={typedProviderFor(settings, keys)} gone={gone ? { old: gone, app: 'Motikord' } : undefined}
        onOpen={open} onRetry={(p) => load(p as Provider, requestHost(HOSTS[p as Provider]))}
        onAddKey={(p) => (p ? onKeys() : onPasteKey())} onConnectCloud={onPenv}
        onPick={pick} />
      {result}
      <p style={{ ...s, margin: 0 }}>Large, strong models write the best clips. Small ones are faster but simpler.</p>
    </>
  );
}

const SHEET: [string, ReactNode][] = [
  ['model-checking · Settings (Model)', <ModelChecking model="gpt-6-astra-2026-09-01" />],
  ['model-check-ok · Settings (Model)', <ModelCheckOk model="gpt-6-astra-2026-09-01" ms={1400} onCheck={() => undefined} />],
  ['model-check-key-refused · Settings (Model)', <ModelCheckProblem problem="key-refused" provider="openai" model="gpt-6.1-sol" />],
  ['model-check-offline · Settings (Model)', <ModelCheckProblem problem="offline" provider="openai" model="gpt-6.1-sol" />],
  ['model-check-busy · Settings (Model)', <ModelCheckProblem problem="busy" provider="openai" model="gpt-6.1-sol" />],
  ['model-check-server-error · Settings (Model)', <ModelCheckProblem problem="server-error" provider="openai" model="gpt-6.1-sol" />],
  ['model-not-found · Settings (Model), Making your clip', <ModelNotFound provider="openai" model="gpt-6-maxi" previous="gpt-6.1-sol" />],
  ['model-not-for-text · Settings (Model)', <ModelNotForText provider="openai" model="gpt-transcribe" />],
  ['model-needs-key · Settings (Model)', <ModelNeedsKey provider="anthropic" />],
  ['model-built-in · Settings (On this computer chosen)', <ModelBuiltIn />],
];

/** Every check state under the Model picker on one sheet. */
export default function SettingsModel() {
  return (
    <main data-frame="SettingsModel" style={{ padding: '20px 12px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {SHEET.map(([name, body]) => (
        <section key={name} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <h2 className="mono" style={{ margin: 0, padding: '0 4px', fontSize: 11, fontWeight: 500, color: 'var(--faint)' }}>{name}</h2>
          <div style={{ padding: 14, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>{body}</div>
        </section>
      ))}
    </main>
  );
}
