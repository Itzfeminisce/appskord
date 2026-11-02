import { useEffect, useState, type ReactNode } from 'react';
import { forgetAll, listItems, listLedger, listPeople, listVectors } from '@/lib/memory/store';
import type { MemorySettings } from '@/lib/memory/types';
import { ensureModel, modelState, removeModel, type ModelState } from '@/lib/recall';
import { MODEL_CACHE, MODEL_ID } from '@/lib/recall/protocol';
import { getSettings, updateSettings } from '@/lib/settings';
import { BackIcon } from '../../components/v4/icons';
import { useRouter } from '../../router';
import './settings.css';

const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const MB = 1024 * 1024;
export const megabytes = (bytes: number) => `${bytes > 0 ? Math.max(1, Math.round(bytes / MB)) : 0} MB`;

/** Dev frames show the downloaded model without writing fake weights into the real cache. */
export const settingsDev: { model?: { state: ModelState; bytes: number } } = {};

async function modelBytes(): Promise<number> {
  if (typeof caches === 'undefined' || !(await caches.has(MODEL_CACHE))) return 0;
  const cache = await caches.open(MODEL_CACHE);
  let total = 0;
  for (const request of (await cache.keys()).filter((r) => r.url.includes(MODEL_ID))) {
    const response = await cache.match(request);
    const length = Number(response?.headers.get('content-length'));
    total += length > 0 ? length : (await response?.blob())?.size ?? 0;
  }
  return total;
}

/** Bytes the memory stores take, roughly as stored: vectors by their numbers and text, the rest as JSON. */
async function memorySize(): Promise<{ items: number; bytes: number }> {
  const [items, people, ledger, vectors] = await Promise.all([listItems(), listPeople(), listLedger(), listVectors()]);
  const json = new Blob([JSON.stringify([items, people, ledger])]).size;
  const vectorBytes = vectors.reduce((n, v) => n + v.v.byteLength + v.text.length + 48, 0);
  return { items: items.length, bytes: json + vectorBytes };
}

const Chevron = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6E7079" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
);

function Text({ title, sub }: { title: string; sub?: string }) {
  return <span className="sm-text"><span className="sm-title">{title}</span>{sub && <span className="sm-sub">{sub}</span>}</span>;
}

function Toggle({ id, title, sub, on, set }: { id: string; title: string; sub: string; on: boolean; set: (on: boolean) => void }) {
  return (
    <label htmlFor={id} className="sm-row">
      <Text title={title} sub={sub} />
      <input id={id} type="checkbox" role="switch" className="sm-switch" checked={on} onChange={(e) => set(e.target.checked)} />
    </label>
  );
}

function LinkRow({ to, title, sub }: { to: string; title: string; sub?: string }) {
  const { navigate, has } = useRouter();
  const ready = has(to);
  return (
    <button type="button" className="sm-row" aria-disabled={!ready || undefined} onClick={() => { if (has(to)) navigate(to); }}>
      <Text title={title} sub={sub} /><Chevron />
    </button>
  );
}

const Row = ({ title, sub, children }: { title: string; sub: string; children: ReactNode }) => (
  <div className="sm-row"><Text title={title} sub={sub} />{children}</div>
);

export default function SettingsMemory() {
  const { back, canGoBack, replace } = useRouter();
  const [memory, setMemory] = useState<MemorySettings | null>(null);
  const [model, setModel] = useState<{ state: ModelState; bytes: number }>({ state: 'none', bytes: 0 });
  const [size, setSize] = useState<{ items: number; bytes: number } | null>(null);

  const loadSize = () => memorySize().then(setSize).catch((error) => console.error('Rekord: could not measure memory', error));
  const loadModel = async () => {
    if (settingsDev.model) return setModel(settingsDev.model);
    const state = await modelState();
    setModel({ state, bytes: state === 'ready' ? await modelBytes() : 0 });
  };

  useEffect(() => {
    getSettings().then((s) => setMemory(s.memory)).catch((error) => console.error('Rekord: could not load your settings', error));
    loadModel().catch((error) => console.error('Rekord: could not check the search model', error));
    void loadSize();
  }, []);

  async function save(partial: Partial<MemorySettings>) {
    try {
      const s = await getSettings();
      setMemory((await updateSettings({ memory: { ...s.memory, ...partial } })).memory);
    } catch (error) {
      console.error('Rekord: could not save your settings', error);
    }
  }

  async function remove() {
    settingsDev.model = undefined;
    await removeModel();
    await save({ searchModel: 'none' });
    await loadModel();
  }

  async function download() {
    setModel({ state: 'downloading', bytes: 0 });
    const ok = await ensureModel().catch(() => false);
    if (ok) await save({ searchModel: 'ready' });
    await loadModel();
  }

  async function forget() {
    try {
      await forgetAll();
      browser.runtime.sendMessage({ type: 'rekord.badge.refresh' }).catch(() => undefined);
    } catch (error) {
      console.error('Rekord: could not forget memory', error);
    }
    await loadSize();
  }

  const m = memory;
  return (
    <main className="sm-screen">
      <header className="sm-head">
        <button type="button" className="v4-icon" aria-label="Back" onClick={() => (canGoBack ? back() : replace('home'))}><BackIcon /></button>
        <h1>Settings</h1>
      </header>
      <div className="sm-body">
        <h2 className="sm-heading">Memory</h2>
        <section aria-label="Memory" className="sm-card">
          <Toggle id="r1" title="Recall cards in meetings" sub="Past promises and decisions, shown as they come up" on={m?.recall ?? false} set={(recall) => void save({ recall })} />
          <Toggle id="r2" title="Clash alerts" sub="Warn when something said now contradicts a decision" on={m?.clash ?? false} set={(clash) => void save({ clash })} />
          <Row title="Brief before meetings" sub="Notification">
            {m && <span className="sm-value">{m.brief.minutes} min</span>}
          </Row>
          <Toggle id="r4" title="Due-day reminders" sub="A nudge on the day a promise is due" on={m?.dueReminders ?? false} set={(dueReminders) => void save({ dueReminders })} />
          <Row title="Weekly look back" sub="What was kept and what slipped">
            {m && <span className="sm-value">{DAYS[m.lookBack.day]} {String(m.lookBack.hour).padStart(2, '0')}:00</span>}
          </Row>
          <Row title="Search model" sub="Finds meetings by meaning">
            {model.state === 'ready' && <><span className="sm-value">Downloaded · {megabytes(model.bytes)}</span><button type="button" className="sm-pill" onClick={() => void remove()}>Remove</button></>}
            {model.state === 'downloading' && <span className="sm-value">Downloading search model</span>}
            {(model.state === 'none' || model.state === 'failed') && <button type="button" className="sm-pill" onClick={() => void download()}>Download (22 MB)</button>}
          </Row>
          <Row title="Memory size" sub="Kept on this computer only">
            {size && <span className="sm-value">{size.items} items · {megabytes(size.bytes)}</span>}
          </Row>
          <LinkRow to="folder" title="Rekord folder" sub="Your notes as plain Markdown files" />
          <LinkRow to="move" title="Move to a new computer" sub="Save everything, bring it back later" />
          <LinkRow to="ledger" title="What left this computer" sub="Every time something was sent out" />
        </section>
        <section aria-label="Danger zone" className="sm-danger">
          <Text title="Forget all memory" sub="Keeps your meetings and transcripts" />
          <button type="button" className="sm-forget" onClick={() => void forget()}>Forget all</button>
        </section>
        <h2 className="sm-heading">AI</h2>
        <section aria-label="AI" className="sm-card" style={{ marginBottom: 24 }}>
          <LinkRow to="settings" title="Settings" />
        </section>
      </div>
    </main>
  );
}
