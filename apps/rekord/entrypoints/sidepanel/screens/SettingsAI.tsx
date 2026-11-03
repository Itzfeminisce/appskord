import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { listModelsFor, LLMError, PROVIDERS as LLM_PROVIDERS, SUGGESTED, type PickerList } from '@appskord/llm';
import { ModelPicker, type PickerGroup, type PickerOption, type PickerValue } from '@appskord/ui';
import { Spinner } from '../components';
import { useRouter } from '../router';
import { connectErrorMessage } from '@/lib/connect';
import { disconnectPenvApp, forgetAll, formatEnvPath, loadKeys, loadPenvAppKeys, loadToken, PenvAppError, reconnect, wasDisconnected } from '@/lib/penv';
import { hostsForKeys, hostsForSettings, OLLAMA_HOSTS, PENV_HOSTS, requestHosts } from '@/lib/hosts';
import { chat } from '@/lib/llm';
import { serviceLabel } from '@appskord/llm';
import { getSettings, PROVIDERS, updateSettings } from '@/lib/settings';
import { keyUse, STATUS_WORD, type RowStatus } from '@/lib/setup';
import type { ProviderId, Settings } from '@/lib/types';
import { DisconnectedPanel } from './PenvConnect';
import { BackIcon, CARD, LINK, MONO, PenvCloudLink, useKeyState } from './setupParts';

function friendly(message: string): string {
  return message.replace(/\bpenv\b/gi, 'Penv Cloud');
}

const SECTION_TITLE = { margin: 0, padding: '0 8px', fontSize: 12, fontWeight: 600, color: '#6E7079' } as const;
const SMALL_BTN = { height: 34, padding: '0 12px', borderRadius: 9, font: 'inherit', fontSize: 12, fontWeight: 600, textDecoration: 'none', display: 'flex', alignItems: 'center', cursor: 'pointer' } as const;

// ---- Model pickers: Transcription and Assistant ----

export type PickerJob = 'transcription' | 'summary';
type Cloud = Exclude<ProviderId, 'ollama'>;
type Listed = 'groq' | 'openai' | Cloud;
/** A provider's list in the picker: being fetched, or fetched (live, or suggested with the error). */
export type ListState = { status: 'loading' } | { status: 'done'; list: PickerList };

export const PICKER_LABEL: Record<PickerJob, string> = { transcription: 'Transcription', summary: 'Assistant' };
export const PICKER_FOOT: Record<PickerJob, string> = {
  transcription: 'Other providers don’t turn speech into text here, so they aren’t listed.',
  summary: 'Writes summaries, answers Ask and finds promises. Each list comes from the provider, using your key.',
};
/** The listed cloud groups of each picker, in the frame's order; Deepgram leads Transcription, Ollama ends Assistant. */
export const PICKER_CLOUD: Record<PickerJob, Listed[]> = {
  transcription: ['groq', 'openai'],
  summary: ['groq', 'openai', 'anthropic', 'google', 'xai', 'openrouter'],
};
const MARK: Record<Cloud, string> = { groq: 'Gq', openai: 'OA', anthropic: 'An', google: 'Gm', xai: 'xA', openrouter: 'OR' };
const ADD_KEY: Record<Cloud, string> = {
  groq: 'Add a Groq key', openai: 'Add an OpenAI key', anthropic: 'Add an Anthropic key',
  google: 'Add a Gemini key', xai: 'Add an xAI key', openrouter: 'Add an OpenRouter key',
};
const ALIASES: Partial<Record<Cloud, string[]>> = { anthropic: ['claude'], google: ['google'], xai: ['grok'] };
const DEEPGRAM_KEY = 'DEEPGRAM_API_KEY';
const DEEPGRAM_MODELS: PickerOption[] = [{ id: 'nova-3', tag: 'Real time · tells voices apart' }];
const OLLAMA = 'ollama:';
export const OLLAMA_DOWN = 'Ollama isn’t running. Start it, then open this list again.';

export interface PickerInputs {
  keys: string[]; // loaded key names, never values
  status: Record<string, RowStatus | undefined>;
  lists: Partial<Record<Listed, ListState>>;
  ollama?: string[] | null; // Ollama's models; null when it did not answer, absent before asking
}

const keyNameOf = (p: Listed | 'deepgram') => (p === 'deepgram' ? DEEPGRAM_KEY : LLM_PROVIDERS[p].keyName!);

/** The picker's value for a saved choice. Ollama sits in the "On this computer" group. */
export function pickerValue(job: PickerJob, s: Pick<Settings, 'transcription' | 'summary'>): PickerValue {
  if (job === 'transcription') return { provider: s.transcription.provider, model: s.transcription.model };
  const { provider, model } = s.summary;
  return provider === 'ollama' ? { provider: 'local', model: OLLAMA + model } : { provider, model };
}

/** The settings to save for a picked row; anything else in the old choice (a `gone` model) is dropped. */
export function choiceFor(job: PickerJob, v: PickerValue, s: Pick<Settings, 'transcription' | 'summary'>): Partial<Settings> {
  if (job === 'transcription') return { transcription: { provider: v.provider as Settings['transcription']['provider'], model: v.model } };
  if (v.provider !== 'local') return { summary: { provider: v.provider as ProviderId, model: v.model } };
  const model = v.model.startsWith(OLLAMA) ? v.model.slice(OLLAMA.length) : v.model;
  const baseUrl = s.summary.provider === 'ollama' ? s.summary.baseUrl : undefined;
  return { summary: baseUrl ? { provider: 'ollama', model, baseUrl } : { provider: 'ollama', model } };
}

/** The hosts Chrome must allow before a picked provider is used. */
export function hostsFor(partial: Partial<Settings>): string[] {
  if (partial.transcription) return hostsForKeys([keyNameOf(partial.transcription.provider as Listed | 'deepgram')]);
  if (partial.summary?.provider === 'ollama') return OLLAMA_HOSTS;
  return partial.summary ? hostsForKeys([PROVIDERS[partial.summary.provider].keyName ?? '']) : [];
}

/** A typed model whose test question failed: a refused key shows picker-key-refused; anything else a line under the picker. */
export function typedFailure(model: string, error: unknown): { refused: LLMError } | { line: string } {
  const code = error instanceof LLMError ? error.code : undefined;
  if (code === 'auth') return { refused: error as LLMError };
  if (code === 'offline' || code === 'rate-limited' || code === 'cancelled') return { line: (error as LLMError).message };
  return { line: `No model called “${model}” in your lists.` };
}

function withCurrent(models: PickerOption[], provider: string, value: PickerValue): PickerOption[] {
  if (value.provider !== provider || !value.model || models.some((m) => m.id === value.model)) return models;
  return [...models, { id: value.model, tag: 'Your choice' }];
}

function deepgramGroup(value: PickerValue, inp: PickerInputs): PickerGroup {
  const base = { id: 'deepgram', name: 'Deepgram', mark: 'Dg', addKeyLabel: 'Add a Deepgram key' };
  if (!inp.keys.includes(DEEPGRAM_KEY)) return { ...base, status: 'needs-key', models: [] };
  const models = withCurrent(DEEPGRAM_MODELS, 'deepgram', value);
  return { ...base, status: inp.status[DEEPGRAM_KEY] === 'rejected' ? 'key-refused' : 'ready', models };
}

function cloudGroup(job: PickerJob, p: Listed, value: PickerValue, inp: PickerInputs): PickerGroup {
  const info = LLM_PROVIDERS[p];
  const base = { id: p, name: info.label, mark: MARK[p], aliases: ALIASES[p], addKeyLabel: ADD_KEY[p] };
  if (!inp.keys.includes(info.keyName!)) return { ...base, status: 'needs-key', models: [] };
  const state = inp.lists[p];
  const suggested = (SUGGESTED[p][job === 'transcription' ? 'speech' : 'chat'] ?? []).map((id, i): PickerOption => (i === 0 ? { id, tag: 'Recommended' } : { id }));
  const list = state?.status === 'done' ? state.list : undefined;
  const models = withCurrent(list?.models.length ? [...list.models] : suggested, p, value);
  if (state?.status === 'loading') return { ...base, status: 'loading', models };
  if (list?.error?.code === 'auth' || inp.status[info.keyName!] === 'rejected') return { ...base, status: 'key-refused', models };
  return { ...base, status: list?.error ? 'failed' : 'ready', models };
}

/** Every group of one picker: Transcription is Deepgram, Groq, OpenAI; Assistant is the chat providers, then "On this computer". */
export function pickerGroups(job: PickerJob, s: Pick<Settings, 'transcription' | 'summary'>, inp: PickerInputs): PickerGroup[] {
  const value = pickerValue(job, s);
  const cloud = PICKER_CLOUD[job].map((p) => cloudGroup(job, p, value, inp));
  if (job === 'transcription') return [deepgramGroup(value, inp), ...cloud];
  const local: PickerGroup = { id: 'local', name: 'On this computer', status: 'local', models: (inp.ollama ?? []).map((n) => ({ id: OLLAMA + n, name: `Ollama · ${n}` })) };
  if (s.summary.provider === 'ollama' && !local.models.some((m) => m.id === value.model)) {
    local.models.push({ id: value.model, name: s.summary.model ? `Ollama · ${s.summary.model}` : 'Ollama' });
  }
  if (inp.ollama === null) local.note = OLLAMA_DOWN;
  return [...cloud, local];
}

/** The provider a typed name goes to: the current cloud one, else the first with a key. */
export function typedProviderFor(job: PickerJob, s: Pick<Settings, 'transcription' | 'summary'>, keys: string[]): string {
  const current = pickerValue(job, s).provider;
  if (current !== 'local') return current;
  return PICKER_CLOUD[job].find((p) => keys.includes(keyNameOf(p))) ?? 'groq';
}

type Lists = Record<PickerJob, Partial<Record<Listed, ListState>>>;

/** "Transcription" and "Assistant": one model picker each. Lists load from each provider when a picker opens. */
function AiPickers({ s, keys, status, save, onAddKey, onConnectCloud, onDenied }: {
  s: Settings;
  keys: string[];
  status: Record<string, RowStatus | undefined>;
  save: (partial: Partial<Settings>) => Promise<void>;
  onAddKey: (provider?: string) => void;
  onConnectCloud: () => void;
  onDenied: () => void;
}) {
  const [lists, setLists] = useState<Lists>({ transcription: {}, summary: {} });
  const [ollama, setOllama] = useState<string[] | null | undefined>(undefined);
  const [failed, setFailed] = useState<Partial<Record<PickerJob, string>>>({});
  const keyNames = keys.join();

  // A key added or removed: its lists load again on the next open.
  useEffect(() => setLists({ transcription: {}, summary: {} }), [keyNames]);

  function load(job: PickerJob, p: Listed) {
    const set = (state: ListState) => setLists((l) => ({ ...l, [job]: { ...l[job], [p]: state } }));
    set({ status: 'loading' });
    loadKeys()
      .then((values) => listModelsFor(p, job === 'transcription' ? 'speech' : 'chat', { key: values[keyNameOf(p)] }))
      .then((list) => set({ status: 'done', list }), (error) => console.error('Rekord: could not load the model list', error));
  }

  function open(job: PickerJob) {
    const withKeys = PICKER_CLOUD[job].filter((p) => keys.includes(keyNameOf(p)) && !lists[job][p]);
    // Opening is a click: ask for the hosts of the lists about to load (and Ollama's after it did not answer).
    const asked = requestHosts([...hostsForKeys(withKeys.map(keyNameOf)), ...(job === 'summary' && ollama === null ? OLLAMA_HOSTS : [])]);
    void asked.then(() => {
      for (const p of withKeys) load(job, p);
      if (job === 'summary') {
        listModelsFor('ollama', 'chat').then((l) => setOllama(l.error || !l.models.length ? null : l.models.map((m) => m.id)), () => setOllama(null));
      }
    });
  }

  async function pick(job: PickerJob, value: PickerValue, typed: boolean) {
    const partial = choiceFor(job, value, s);
    // Asked on the click itself, so Chrome shows its prompt; an allowed host answers at once.
    if (!(await requestHosts(hostsFor(partial)))) return onDenied();
    setFailed((f) => ({ ...f, [job]: undefined }));
    if (typed && job === 'summary' && value.provider !== 'local') {
      const p = value.provider as Cloud;
      try {
        await chat([{ role: 'user', content: 'Reply with OK.' }], { maxTokens: 16, typed: true, config: { settings: { ...s, ...partial }, keys: await loadKeys() } });
      } catch (error) {
        console.error('Rekord: the typed model did not answer', error);
        const failure = typedFailure(value.model, error);
        if ('refused' in failure) {
          const prev = lists[job][p];
          const models = prev?.status === 'done' ? prev.list.models : [];
          setLists((l) => ({ ...l, [job]: { ...l[job], [p]: { status: 'done', list: { models, source: 'suggested', error: failure.refused } } } }));
        } else setFailed((f) => ({ ...f, [job]: failure.line }));
        return;
      }
    }
    await save(partial);
  }

  return (
    <>
      {(['transcription', 'summary'] as const).map((job) => {
        const gone = s[job].gone;
        return (
          <div key={job} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <ModelPicker
              label={PICKER_LABEL[job]}
              foot={PICKER_FOOT[job]}
              groups={pickerGroups(job, s, { keys, status, lists: lists[job], ...(job === 'summary' ? { ollama } : {}) })}
              value={pickerValue(job, s)}
              typedProvider={typedProviderFor(job, s, keys)}
              gone={gone ? { old: gone, app: 'Rekord' } : undefined}
              onOpen={() => open(job)}
              onRetry={(p) => p !== 'deepgram' && load(job, p as Listed)}
              onAddKey={onAddKey}
              onConnectCloud={onConnectCloud}
              onPick={(value, typed) => void pick(job, value, typed)}
            />
            {failed[job] && <div role="alert" style={{ fontSize: 12, color: '#B42318', margin: '0 2px' }}>{failed[job]}</div>}
          </div>
        );
      })}
    </>
  );
}

export default function SettingsAI() {
  const { navigate, replace } = useRouter();
  const [s, setS] = useState<Settings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [hasToken, setHasToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const keys = useKeyState();

  useEffect(() => {
    Promise.all([getSettings(), loadToken(), wasDisconnected().catch(() => false)])
      .then(([settings, token, gone]) => {
        setS(settings);
        setHasToken(!!token);
        setDisconnected(gone && settings.keySource === 'penv-app');
      })
      .catch(() => setLoadFailed(true));
  }, []);

  const refreshToken = useCallback(async () => setHasToken(!!(await loadToken())), []);

  const header = (
    <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px 0' }}>
      <button
        type="button"
        aria-label="Back to home"
        onClick={() => replace('start')}
        style={{ width: 36, height: 36, border: 'none', borderRadius: 10, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111114', cursor: 'pointer' }}
      >
        <BackIcon />
      </button>
      <h1 style={{ margin: 0, flexGrow: 1, fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>Settings</h1>
    </header>
  );

  if (loadFailed) {
    return (
      <main className="screen">
        {header}
        <div className="perm-error" role="alert" style={{ margin: 16 }}>Rekord couldn’t load your settings. Try reopening the side panel.</div>
      </main>
    );
  }
  if (!s) {
    return (
      <main className="screen">
        {header}
        <div className="set-loading"><Spinner label="Loading settings" /></div>
      </main>
    );
  }

  const penvSource = s.keySource !== 'paste';
  const path = s.keySource === 'penv-app' && s.penvApp ? `${s.penvApp.org}/${s.penvApp.project}/${s.penvApp.env}` : formatEnvPath(s.penv);
  const canDisconnect = keys.loaded.length > 0 || hasToken || (s.keySource === 'penv-app' && !!s.penvApp);

  async function refresh() {
    setMessage(null);
    const app = s?.keySource === 'penv-app' ? s.penvApp : undefined;
    if (!app && !hasToken) return navigate('penvConnect');
    setBusy(true);
    if (!(await requestHosts([...PENV_HOSTS, ...hostsForSettings(s!, keys.loaded)]))) {
      setBusy(false);
      return setMessage({ kind: 'error', text: 'Rekord needs your permission to reach your AI service. Try again and choose Allow.' });
    }
    try {
      const names = app ? await loadPenvAppKeys(app) : await reconnect();
      if (!names) return navigate('penvConnect');
      setMessage({ kind: 'ok', text: `Keys refreshed: ${names.map(serviceLabel).join(', ')}.` });
    } catch (err) {
      if (err instanceof PenvAppError && err.code === 'disconnected') setDisconnected(true);
      else setMessage({ kind: 'error', text: friendly(connectErrorMessage(err)) });
    } finally {
      await Promise.all([keys.reload(), refreshToken()]);
      setBusy(false);
    }
  }

  async function disconnect() {
    setMessage(null);
    setConfirm(false);
    if (s?.keySource === 'penv-app') {
      // Revoke the grant on Penv Cloud, clear keys, back to Setup.
      try {
        await disconnectPenvApp();
        await forgetAll();
        await updateSettings({ keySource: 'penv', penvApp: undefined });
        return replace('connect');
      } catch {
        setMessage({ kind: 'error', text: 'Couldn’t disconnect. Try again.' });
        return;
      }
    }
    try {
      await forgetAll();
      setMessage({ kind: 'ok', text: 'Disconnected. Rekord cleared its keys from memory.' });
    } catch {
      setMessage({ kind: 'error', text: 'Couldn’t disconnect. Try again.' });
    }
    await Promise.all([keys.reload(), refreshToken()]);
  }

  async function setBackup(on: boolean) {
    try {
      setS(await updateSettings({ realtimeBackup: on }));
    } catch {
      setMessage({ kind: 'error', text: 'Couldn’t save that change. Try again.' });
    }
  }

  async function savePick(partial: Partial<Settings>) {
    try {
      setS(await updateSettings(partial));
    } catch {
      setMessage({ kind: 'error', text: 'Couldn’t save that change. Try again.' });
    }
  }

  // A key row scrolls to Your keys; "Paste a key instead" opens Setup, where keys are pasted.
  const addKey = (provider?: string) => (provider ? document.getElementById('keys')?.scrollIntoView({ behavior: 'smooth' }) : navigate('connect'));

  return (
    <main className="screen" style={{ background: '#F6F6F7', color: '#111114' }}>
      {header}
      <div style={{ flexGrow: 1, padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <section aria-labelledby="h-ai" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ margin: '0 8px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <h2 id="h-ai" style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#44464D' }}>AI</h2>
            <button type="button" onClick={() => navigate('howItWorks')} style={{ ...LINK, alignSelf: 'flex-start', padding: 0, border: 'none', background: 'transparent', font: 'inherit', fontSize: 12, fontWeight: 400, color: '#6E7079', cursor: 'pointer' }}>
              How Rekord handles your meetings
            </button>
          </div>
          <div style={{ ...CARD, borderColor: '#EFEFF1', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12, '--tint': '#EEF2FF' } as CSSProperties}>
            <AiPickers
              s={s}
              keys={keys.loaded}
              status={keys.status}
              save={savePick}
              onAddKey={addKey}
              onConnectCloud={() => navigate('penvConnect')}
              onDenied={() => setMessage({ kind: 'error', text: 'Rekord needs your permission to reach your AI service. Try again and choose Allow.' })}
            />
            {s.transcription.provider === 'deepgram' && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, paddingTop: 4, borderTop: '1px solid #EFEFF1' }}>
                <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 10 }}>
                  <span style={{ fontSize: 14 }}>Keep transcribing if Deepgram stops</span>
                  <span style={{ fontSize: 12, color: '#6E7079' }}>Switches to Groq. Text appears a few seconds later.</span>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={s.realtimeBackup}
                  onChange={(e) => void setBackup(e.target.checked)}
                  aria-label="Keep transcribing if Deepgram stops"
                  style={{ width: 18, height: 18, margin: '13px 0 0', accentColor: '#4F46E5' }}
                />
              </label>
            )}
          </div>
        </section>

        <section id="keys" aria-labelledby="h-keys" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 id="h-keys" style={SECTION_TITLE}>Your keys</h2>
          <div style={{ ...CARD, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: 9, background: '#111114', color: '#FFFFFF', fontFamily: MONO, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{penvSource ? 'pv' : 'key'}</span>
              <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {penvSource ? (
                  <>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Loaded from <PenvCloudLink /></span>
                    <span style={{ fontFamily: MONO, fontSize: 11, color: '#6E7079' }}>{path}</span>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>Pasted in this browser</span>
                    <span style={{ fontSize: 12, color: '#6E7079' }}>Kept in memory only</span>
                  </>
                )}
              </span>
              {penvSource && (
                <button
                  type="button"
                  onClick={() => void refresh()}
                  disabled={busy}
                  style={{ height: 30, padding: '0 10px', border: '1px solid #E8E8EB', borderRadius: 8, background: '#FFFFFF', font: 'inherit', fontSize: 12, fontWeight: 600, color: '#111114', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {busy && <Spinner label="Refreshing keys" size={12} />}
                  {busy ? 'Refreshing…' : 'Refresh'}
                </button>
              )}
            </div>

            {disconnected && <DisconnectedPanel onConnect={() => navigate('penvConnect')} />}

            {keys.loaded.length > 0 ? (
              <ul aria-label="Your keys" style={{ listStyle: 'none', margin: 0, padding: '10px 12px', borderRadius: 10, background: '#F6F6F7', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {keys.loaded.map((n) => {
                  const use = keyUse(n, s);
                  const idle = use === 'not in use';
                  const st = keys.status[n] ?? 'checking';
                  return (
                    <li key={n} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <span style={{ flexGrow: 1 }}>
                        <span style={{ fontWeight: 600 }}>{serviceLabel(n)}</span> <span style={{ color: '#6E7079' }}>· {use}</span>
                      </span>
                      <span style={{ fontWeight: idle ? 500 : 600, color: idle ? '#6E7079' : st === 'ok' ? '#1A6B40' : st === 'rejected' ? '#B42318' : '#6E7079' }}>
                        {idle ? 'Saved for later' : STATUS_WORD[st]}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p style={{ margin: 0, padding: '10px 12px', borderRadius: 10, background: '#F6F6F7', fontSize: 12, color: '#5F6168' }}>No keys are loaded right now.</p>
            )}

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => navigate('connect')} style={{ ...SMALL_BTN, border: 'none', background: '#111114', color: '#FFFFFF' }}>
                Change how Rekord works
              </button>
              {penvSource && (
                <a href="https://penv.cloud" target="_blank" rel="noreferrer" style={{ ...SMALL_BTN, background: '#FFFFFF', border: '1px solid #E8E8EB', color: '#111114' }}>
                  Manage on Penv Cloud
                </a>
              )}
              {canDisconnect && !confirm && (
                <button type="button" onClick={() => setConfirm(true)} style={{ ...SMALL_BTN, border: '1px solid #F2C9C7', background: '#FFFFFF', color: '#B42318' }}>
                  Disconnect
                </button>
              )}
            </div>

            {confirm && (
              <div role="alertdialog" aria-label="Disconnect" style={{ padding: 12, borderRadius: 12, background: '#FDECEC', border: '1px solid #F2C9C7', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, lineHeight: 1.45, color: '#8A1C14' }}>
                <span>
                  {penvSource
                    ? 'Disconnect from Penv Cloud? Rekord forgets the token and clears its keys from memory.'
                    : 'Clear the keys you pasted? Rekord forgets them and you will need to paste them again.'}
                </span>
                <span style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={() => setConfirm(false)} style={{ ...SMALL_BTN, border: '1px solid #E8E8EB', background: '#FFFFFF', color: '#111114' }}>Cancel</button>
                  <button type="button" onClick={() => void disconnect()} autoFocus style={{ ...SMALL_BTN, border: '1px solid #F2C9C7', background: '#FFFFFF', color: '#B42318' }}>Disconnect</button>
                </span>
              </div>
            )}
          </div>
          <p style={{ margin: '0 8px', fontSize: 12, color: '#6E7079' }}>Add a key and its models appear in the lists above.</p>
        </section>

        {message && (
          <div className={message.kind === 'error' ? 'perm-error' : 'set-ok'} role={message.kind === 'error' ? 'alert' : 'status'}>
            {message.text}
          </div>
        )}

        <section aria-labelledby="h-more" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 id="h-more" style={SECTION_TITLE}>More</h2>
          <div style={{ ...CARD, display: 'flex', flexDirection: 'column' }}>
            <button
              type="button"
              onClick={() => navigate('connections')}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, border: 'none', borderBottom: '1px solid #F0F0F2', background: 'transparent', font: 'inherit', textAlign: 'left', color: '#111114', cursor: 'pointer' }}
            >
              <span style={{ flexGrow: 1, fontSize: 14, fontWeight: 500 }}>Connected apps</span>
              <span style={{ fontSize: 12, color: '#6E7079' }}>Calendar, Docs, Notion</span>
            </button>
            <button
              type="button"
              onClick={() => navigate('settingsMore')}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, border: 'none', background: 'transparent', font: 'inherit', textAlign: 'left', color: '#111114', cursor: 'pointer' }}
            >
              <span style={{ flexGrow: 1, fontSize: 14, fontWeight: 500 }}>Recording, language and data</span>
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
