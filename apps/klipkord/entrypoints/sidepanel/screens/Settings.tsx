import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { listModelsFor } from '@appskord/llm';
import { ModelPicker, type PickerValue } from '@appskord/ui';
import { Spinner } from '../components';
import { useRouter } from '../router';
import { bubbleMode } from '@/lib/bubble';
import { putFolderHandle } from '@/lib/db';
import { forgetGoogleToken, getGoogleToken } from '@/lib/googleAuth';
import { chat, PROVIDERS } from '@/lib/llm';
import { builtinAvailable } from '@/lib/notes/engines';
import { loadKeys, requestHosts, wasDisconnected } from '@/lib/penv';
import { getSettings, onSettingsChanged, updateSettings } from '@/lib/settings';
import { isModelCached, removeCachedModels } from '@/lib/transcribe/cache';
import { downloadModel } from '@/lib/transcribe/download';
import { megabytes } from '@/lib/transcribe/whisper';
import {
  choiceFor, hostFor, penvRowStatus, PICKER_CLOUD, PICKER_FOOT, PICKER_LABEL, pickerGroups, pickerValue, REPO_URL, SHORTCUTS_URL, typedFailure,
  type ListState, type PickerJob,
} from '@/lib/setup';
import { formatBytes } from '@/lib/time';
import { videoStore } from '@/lib/videoStore';
import type { CloudNotes, Settings as SettingsData } from '@/lib/types';
import { BannerAction, CARD, StateBanner, useKeyState } from './Setup';

const LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'tr', 'ru', 'ar', 'hi', 'ja', 'ko', 'zh'];

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

type Lists = Record<PickerJob, Partial<Record<CloudNotes, ListState>>>;

/** "Transcripts" and "Notes and Ask": one model picker each. Lists load from each provider when a picker opens. */
function AiPickers({ s, loadedKeys, save, navigate }: {
  s: SettingsData; loadedKeys: string[]; save: (partial: Partial<SettingsData>) => void; navigate: (screen: 'PasteKey' | 'PenvConnect') => void;
}) {
  const [lists, setLists] = useState<Lists>({ transcripts: {}, notes: {} });
  const [builtin, setBuiltin] = useState(false);
  const [ollama, setOllama] = useState<string[] | null | undefined>(undefined);
  const [failed, setFailed] = useState<Partial<Record<PickerJob, string>>>({});
  const keyNames = loadedKeys.join();

  useEffect(() => { builtinAvailable().then(setBuiltin, () => undefined); }, []);
  // A key added or removed: its lists load again on the next open.
  useEffect(() => setLists({ transcripts: {}, notes: {} }), [keyNames]);

  function load(job: PickerJob, p: CloudNotes) {
    const set = (state: ListState) => setLists((l) => ({ ...l, [job]: { ...l[job], [p]: state } }));
    set({ status: 'loading' });
    loadKeys()
      .then((keys) => listModelsFor(p, job === 'transcripts' ? 'speech' : 'chat', { key: keys[PROVIDERS[p].keyName] }))
      .then((list) => set({ status: 'done', list }), (error) => console.error('Klipkord: could not load the model list', error));
  }

  function open(job: PickerJob) {
    for (const p of PICKER_CLOUD[job]) if (loadedKeys.includes(PROVIDERS[p].keyName) && !lists[job][p]) load(job, p);
    if (job === 'notes') {
      listModelsFor('ollama', 'chat').then((l) => setOllama(l.error || !l.models.length ? null : l.models.map((m) => m.id)), () => setOllama(null));
    }
  }

  async function pick(job: PickerJob, value: PickerValue, typed: boolean) {
    const choice = choiceFor(job, value);
    const host = hostFor(choice);
    // Asked on the click itself, so Chrome shows its prompt; already allowed answers at once.
    const allowed = host ? requestHosts([host]) : Promise.resolve(true);
    if (!(await allowed)) return;
    setFailed((f) => ({ ...f, [job]: undefined }));
    if (typed && job === 'notes' && choice.provider in PROVIDERS) {
      const p = choice.provider as CloudNotes;
      try {
        // A gone model would be swapped for a listed one; for a typed name that means it did not answer.
        let swapped = false;
        await chat([{ role: 'user', content: 'Reply with OK.' }], { provider: p, model: choice.model, maxTokens: 16, onRepick: () => { swapped = true; } });
        if (swapped) throw new Error('The typed model is not offered.');
      } catch (error) {
        console.error('Klipkord: the typed model did not answer', error);
        const failure = typedFailure(choice.model, error);
        if ('refused' in failure) {
          const prev = lists[job][p];
          const models = prev?.status === 'done' ? prev.list.models : [];
          setLists((l) => ({ ...l, [job]: { ...l[job], [p]: { status: 'done', list: { models, source: 'suggested', error: failure.refused } } } }));
        } else setFailed((f) => ({ ...f, [job]: failure.line }));
        return;
      }
    }
    save({ [job]: choice });
  }

  const typedProvider = (job: PickerJob) => {
    const current = pickerValue(job, s).provider;
    return current !== 'local' ? current : (PICKER_CLOUD[job].find((p) => loadedKeys.includes(PROVIDERS[p].keyName)) ?? 'groq');
  };
  const goKeys = () => navigate('PasteKey'); // PasteKey detects the provider from the pasted key

  return (
    <>
      {(['transcripts', 'notes'] as const).map((job) => {
        const gone = s[job].gone;
        return (
          <Fragment key={job}>
          <ModelPicker label={PICKER_LABEL[job]} foot={PICKER_FOOT[job]}
            groups={pickerGroups(job, s, { keys: loadedKeys, lists: lists[job], builtin, ...(job === 'notes' ? { ollama } : {}) })}
            value={pickerValue(job, s)} typedProvider={typedProvider(job)}
            gone={gone ? { old: gone, app: 'Klipkord' } : undefined}
            onOpen={() => open(job)} onRetry={(p) => load(job, p as CloudNotes)} onAddKey={goKeys}
            onConnectCloud={() => navigate('PenvConnect')}
            onPick={(value, typed) => void pick(job, value, typed)} />
          {failed[job] && <div role="alert" style={{ fontSize: 12, color: '#B91C1C', margin: '-2px 2px 4px' }}>{failed[job]}</div>}
          </Fragment>
        );
      })}
    </>
  );
}

const LINK = { textDecoration: 'none', fontWeight: 500, color: '#C2410C', background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' } as const;
const SELECT = { height: 36, padding: '0 8px', borderRadius: 8, border: '1px solid #DCDCE0', background: '#FFFFFF', font: 'inherit', fontSize: 13, color: '#111114' } as const;
const ROW = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, gap: 12 } as const;
const VALUE = { fontSize: 13, color: '#5F6168' } as const;
const DIVIDER = <div style={{ height: 1, background: '#EFEFF1', margin: '0 14px' }} />;

function Section({ title, id, children, note }: { title: string; id?: string; children: ReactNode; note?: string }) {
  return (
    <section id={id} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h2 style={{ margin: '0 8px', fontSize: 12, fontWeight: 600, color: '#5F6168' }}>{title}</h2>
      {children}
      {note && <span style={{ margin: '0 8px', fontSize: 12, color: '#6E7079' }}>{note}</span>}
    </section>
  );
}

type Local = { phase: 'checking' | 'none' | 'ready' } | { phase: 'downloading'; loaded: number; total: number };
const ROW_BTN: CSSProperties = { height: 44, padding: '0 12px', borderRadius: 9, font: 'inherit', fontSize: 13, fontWeight: 500, flexShrink: 0, cursor: 'pointer' };
const QUIET_BTN: CSSProperties = { ...ROW_BTN, border: '1px solid #E8E8EB', background: '#FFFFFF', color: '#111114' };

/** "Model on this computer": download the Whisper model, cancel, or remove it. */
function LocalModelRow() {
  const [local, setLocal] = useState<Local>({ phase: 'checking' });
  const whisper = useRef<{ stop: () => void } | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    isModelCached().then((c) => setLocal({ phase: c ? 'ready' : 'none' }), () => setLocal({ phase: 'none' }));
    return () => whisper.current?.stop();
  }, []);

  async function download() {
    const job = { stop: () => undefined };
    whisper.current = job;
    setLocal({ phase: 'downloading', loaded: 0, total: 0 });
    try {
      await updateSettings({ localModelAsked: true });
      await downloadModel(job, (loaded, total) => setLocal({ phase: 'downloading', loaded, total }));
      setLocal({ phase: 'ready' });
    } catch (error) {
      // Cancel ends the worker, which lands here too.
      if (whisper.current === job) console.error('Klipkord: could not download the speech model', error);
      setLocal({ phase: 'none' });
    } finally {
      if (whisper.current === job) whisper.current = null;
    }
  }

  function cancel() {
    const job = whisper.current;
    whisper.current = null;
    job?.stop();
    setLocal({ phase: 'none' });
  }

  async function remove() {
    if (whisper.current || removing) return;
    setRemoving(true);
    try {
      await removeCachedModels();
      await updateSettings({ localModelAsked: false });
      setLocal({ phase: 'none' });
    } catch (error) {
      console.error('Klipkord: could not remove the speech model', error);
    } finally {
      setRemoving(false);
    }
  }

  const downloading = local.phase === 'downloading';
  const status = local.phase === 'ready' ? 'Downloaded · Whisper' : downloading ? `Downloading · ${megabytes(local.loaded)} of ${megabytes(local.total)} MB` : 'Not downloaded';
  const pct = downloading && local.total > 0 ? Math.min(100, Math.round((local.loaded / local.total) * 100)) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, border: '1px solid #E8E8EB', background: '#FAFAFB' }}>
      <span style={{ width: 30, height: 30, borderRadius: 8, background: '#F1F1F3', color: '#44464D', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="11" rx="2" /><path d="M2 20h20" /></svg>
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 14, fontWeight: 500 }}>Model on this computer</span>
        <span style={{ fontSize: 12, color: '#5F6168' }}>{status}</span>
        {downloading && (
          <span role="progressbar" aria-label="Downloading the model" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 6, borderRadius: 999, background: '#F1F1F3', overflow: 'hidden' }}>
            <span style={{ display: 'block', width: `${pct}%`, height: '100%', background: '#C2410C' }} />
          </span>
        )}
      </span>
      {local.phase === 'none' && <button type="button" onClick={() => void download()} disabled={removing} style={{ ...ROW_BTN, border: 'none', background: '#C2410C', color: '#FFFFFF' }}>Download</button>}
      {downloading && <button type="button" onClick={cancel} style={QUIET_BTN}>Cancel</button>}
      {local.phase === 'ready' && <button type="button" onClick={() => void remove()} disabled={removing || downloading} style={QUIET_BTN}>Remove</button>}
    </div>
  );
}

export default function Settings() {
  const { navigate, replace } = useRouter();
  const keys = useKeyState();
  const [s, setS] = useState<SettingsData | null>(null);
  const [gone, setGone] = useState(false);
  const [used, setUsed] = useState<number | null>(null);
  const [google, setGoogle] = useState(false);

  useEffect(() => {
    getSettings().then(setS).catch((error) => console.error('Klipkord: could not read settings', error));
    wasDisconnected().then(setGone).catch(() => undefined);
    getGoogleToken().then((t) => setGoogle(!!t), (error) => console.error('Klipkord: could not read the Google sign-in', error));
    videoStore.usage().then((u) => setUsed(u.usage)).catch((error) => console.error('Klipkord: could not read storage use', error));
    return onSettingsChanged(setS);
  }, []);

  // "Where your data goes" on the welcome screen opens Settings at this section.
  useEffect(() => {
    if (s && location.hash === '#privacy') {
      document.getElementById('privacy')?.scrollIntoView();
      history.replaceState(null, '', location.pathname + location.search);
    }
  }, [s]);

  if (!s) {
    return (
      <main className="screen screen-center">
        <Spinner label="Loading" />
      </main>
    );
  }

  const connected = s.keySource === 'penv-app' && !!s.penvApp && !gone;
  const penvStatus = penvRowStatus(connected, keys.loaded);

  const save = (partial: Parameters<typeof updateSettings>[0]) =>
    updateSettings(partial).then(setS).catch((error) => console.error('Klipkord: could not save settings', error));

  async function changeFolder() {
    try {
      const pick = (window as unknown as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
      if (!pick) return;
      const handle = await pick({ mode: 'readwrite' });
      await putFolderHandle(handle);
      await save({ folderName: handle.name });
    } catch (error) {
      if ((error as { name?: string }).name !== 'AbortError') console.error('Klipkord: could not change the save folder', error);
    }
  }

  const lang = s.language;
  const codes = lang === 'auto' || LANGUAGES.includes(lang) ? LANGUAGES : [...LANGUAGES, lang];

  return (
    <main className="screen" style={{ background: '#F6F6F7', color: '#111114' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '12px 16px 0' }}>
        <button type="button" aria-label="Back to recorder" onClick={() => replace('Home')} style={{ width: 44, height: 44, borderRadius: 12, border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111114', cursor: 'pointer' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em' }}>Settings</h1>
      </div>

      <div style={{ padding: '8px 16px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {gone && (
          <StateBanner mark="pv" tone="error" title="Penv Cloud is disconnected" body="Klipkord is using on-device AI until you connect again."
            action={<BannerAction onClick={() => navigate('PenvConnect')}>Connect again</BannerAction>} />
        )}

        <Section title="AI">
          <div style={{ ...CARD, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12, '--tint': '#FFF7ED' } as CSSProperties}>
            <AiPickers s={s} loadedKeys={keys.loaded} save={(partial) => void save(partial)} navigate={navigate} />
            <LocalModelRow />
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: '#5F6168' }}>On this computer, nothing is sent. A cloud model is faster and uses your key.</p>
            <div style={ROW}>
              <span>Language</span>
              <span style={{ ...VALUE, display: 'flex', alignItems: 'center', gap: 6 }}>
                <select aria-label="Language" value={lang} onChange={(e) => void save({ language: e.target.value })} style={SELECT}>
                  <option value="auto">Detect automatically</option>
                  {codes.map((c) => <option key={c} value={c}>{languageName(c)}</option>)}
                </select>
                {lang !== 'auto' && <>· <button type="button" onClick={() => void save({ language: 'auto' })} style={LINK}>Detect automatically</button></>}
              </span>
            </div>
          </div>
        </Section>

        <Section title="Keys for cloud AI" id="keys" note="Only needed for a cloud model. Add a key and its models appear in the list.">
          <div style={{ ...CARD, display: 'flex', flexDirection: 'column' }}>
            <button type="button" onClick={() => navigate(connected ? 'PenvConnected' : 'PenvConnect')} style={{ padding: '12px 14px', border: 'none', background: 'transparent', font: 'inherit', color: '#111114', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
              <span style={{ width: 32, height: 32, borderRadius: 9, background: '#111114', color: '#FFFFFF', fontFamily: 'var(--mono)', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>pv</span>
              <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>Penv Cloud</span>
                {penvStatus && <span style={{ fontSize: 12, color: '#5F6168' }}>{penvStatus}</span>}
              </span>
              <span style={{ fontSize: 13, fontWeight: 500, color: '#C2410C' }}>Manage</span>
            </button>
            {DIVIDER}
            <button type="button" onClick={() => navigate('PasteKey')} style={{ padding: '12px 14px', border: 'none', background: 'transparent', font: 'inherit', color: '#111114', display: 'flex', justifyContent: 'space-between', fontSize: 14, cursor: 'pointer' }}>
              <span>Paste a key instead</span><span style={{ color: '#9A9BA3' }} aria-hidden="true">›</span>
            </button>
          </div>
        </Section>

        {/* The frame has only the connected row; with no Google sign-in there is nothing to show. */}
        {google && (
          <Section title="Sharing links">
            <div style={{ ...CARD, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>Google Drive</span>
                <span style={{ fontSize: 12, color: '#15803D' }}>Connected · sees only files Klipkord uploads</span>
              </span>
              <button type="button" onClick={() => forgetGoogleToken().then(() => setGoogle(false), (error) => console.error('Klipkord: could not disconnect Google', error))}
                style={{ height: 36, padding: '0 12px', border: '1px solid #E8E8EB', borderRadius: 10, background: '#FFFFFF', font: 'inherit', fontSize: 13, fontWeight: 500, color: '#111114', cursor: 'pointer' }}>Disconnect</button>
            </div>
          </Section>
        )}

        <Section title="Recording">
          <div style={{ ...CARD, display: 'flex', flexDirection: 'column' }}>
            <div style={{ ...ROW, padding: '12px 14px' }}>
              <span>Save folder</span>
              <span style={VALUE}>{s.folderName && <>{s.folderName} · </>}<button type="button" onClick={() => void changeFolder()} style={LINK}>Change</button></span>
            </div>
            {DIVIDER}
            <div style={{ ...ROW, padding: '12px 14px' }}>
              <span>Keyboard shortcuts</span>
              <button type="button" onClick={() => void browser.tabs.create({ url: SHORTCUTS_URL })} style={{ ...LINK, fontSize: 13 }}>Change in Chrome</button>
            </div>
            {DIVIDER}
            <div style={{ ...ROW, padding: '12px 14px' }}>
              <span>Storage</span>
              <span style={VALUE}>{used !== null && <>{formatBytes(used)} · </>}<button type="button" onClick={() => navigate('Storage')} style={LINK}>Free up space</button></span>
            </div>
            {DIVIDER}
            <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 14 }}>Camera bubble</span>
              <div role="radiogroup" aria-label="Camera bubble" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 4, padding: 4, borderRadius: 10, background: '#F1F1F3' }}>
                {([['floating', 'Floating on screen'], ['video', 'Drawn into the video']] as const).map(([mode, label]) => {
                  const on = bubbleMode(s.bubble) === mode;
                  return (
                    <button key={mode} type="button" role="radio" aria-checked={on} onClick={() => void save({ bubble: { mode } })}
                      style={{ height: 32, borderRadius: 7, border: 'none', font: 'inherit', fontSize: 12, cursor: 'pointer', ...(on ? { background: '#FFFFFF', fontWeight: 600, boxShadow: '0 1px 2px rgba(16,16,20,0.08)' } : { background: 'transparent', fontWeight: 500, color: '#5F6168' }) }}>
                      {label}
                    </button>
                  );
                })}
              </div>
              <span style={{ fontSize: 12, lineHeight: 1.45, color: '#6E7079' }}>{s.bakeCamera ? 'Tab recordings draw the bubble into the video, as in v2.' : 'The camera is saved as its own track, so you can move or resize it in the editor.'}</span>
            </div>
            {DIVIDER}
            <div style={{ ...ROW, padding: '12px 14px' }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span id="bake-camera-label">Bake camera into the video</span>
                <span style={{ fontSize: 12, lineHeight: 1.45, color: '#6E7079' }}>For people who only download. Off keeps the camera separate for the editor.</span>
              </span>
              <button type="button" role="switch" aria-checked={s.bakeCamera} aria-labelledby="bake-camera-label" onClick={() => void save({ bakeCamera: !s.bakeCamera })}
                style={{ width: 40, height: 24, border: 'none', borderRadius: 999, background: s.bakeCamera ? '#C2410C' : '#DCDCE0', position: 'relative', flexShrink: 0, cursor: 'pointer' }}>
                <span style={{ position: 'absolute', top: 3, [s.bakeCamera ? 'right' : 'left']: 3, width: 18, height: 18, borderRadius: '50%', background: '#FFFFFF' }} />
              </button>
            </div>
          </div>
        </Section>

        <Section title="Where your data goes" id="privacy">
          <div style={{ ...CARD, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13, lineHeight: 1.45, color: '#44464D' }}>
            <span>Video, camera and notes never leave this computer.</span>
            <span>With a cloud model picked, only your voice and transcript go to that provider.</span>
            <span>No account, no analytics, no tracking.</span>
          </div>
        </Section>
      </div>

      <div style={{ flexGrow: 1 }} />
      <p style={{ margin: '14px 24px 18px', fontSize: 12, color: '#6E7079' }}>
        Klipkord 3.1 · <a href={REPO_URL} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', fontWeight: 500 }}>Open source on GitHub</a>
      </p>
    </main>
  );
}
