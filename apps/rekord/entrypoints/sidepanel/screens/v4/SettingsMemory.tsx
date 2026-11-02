import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { listMeetings } from '@/lib/db';
import { DECISIONS_PATH, OPEN_LOOPS_PATH, removePersonFiles } from '@/lib/folder';
import { forgetAll, listItems, listLedger, listPeople, listVectors } from '@/lib/memory/store';
import type { MemorySettings } from '@/lib/memory/types';
import { ensureModel, modelFailureText, modelState, removeModel, type ModelResult, type ModelState, type Progress } from '@/lib/recall';
import { MODEL_CACHE, MODEL_ID } from '@/lib/recall/protocol';
import { getSettings, updateSettings } from '@/lib/settings';
import { BackIcon } from '../../components/v4/icons';
import { ModelDownloadCard, ModelFailedBanner } from '../../components/v4/states';
import { useRouter } from '../../router';
import './settings.css';
import { refreshBadge } from '@/lib/messages';

const DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const MB = 1024 * 1024;
export const megabytes = (bytes: number) => `${bytes > 0 ? Math.max(1, Math.round(bytes / MB)) : 0} MB`;

/** Dev frames show the downloaded model without writing fake weights into the real cache, and can open "Forget all memory?". */
export const settingsDev: { model?: { state: ModelState; bytes: number }; forgetAll?: boolean } = {};

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

interface ForgetPlan { items: number; people: number; meetings: number; folder: boolean }

/** V4ForgetAll: what goes and what stays; nothing goes until "forget" is typed and "Forget all memory" pressed. */
function ForgetAllSheet({ plan, onForget, onKeep }: { plan: ForgetPlan; onForget: () => Promise<void>; onKeep: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = typed.trim().toLowerCase() === 'forget';
  const focusSheet = useCallback((el: HTMLElement | null) => el?.focus(), []);
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') onKeep(); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [onKeep]);
  const forget = async () => {
    if (!ready || busy) return;
    setBusy(true);
    await onForget();
  };
  return (
    <>
      <div className="fa-scrim" onClick={onKeep} aria-hidden="true" />
      <section role="dialog" aria-modal="true" aria-labelledby="fa-title" className="fa-sheet" tabIndex={-1} ref={focusSheet}>
        <span className="fa-grip" aria-hidden="true" />
        <h1 id="fa-title">Forget all memory?</h1>
        <div className="fa-lists">
          <div className="fa-box fa-goes">
            <span>Goes</span>
            <ul>
              <li><span className="fa-dot" /><span><span className="fa-mono">{plan.items}</span> items</span></li>
              <li><span className="fa-dot" /><span><span className="fa-mono">{plan.people}</span> people</span></li>
              <li><span className="fa-dot" /><span>Search entries</span></li>
              {plan.folder && <li><span className="fa-dot" /><span>The memory files in the Rekord folder</span></li>}
            </ul>
          </div>
          <div className="fa-box fa-stays">
            <span>Stays</span>
            <ul><li><span className="fa-dot" /><span>Your <span className="fa-mono">{plan.meetings}</span> meetings, transcripts, audio and summaries</span></li></ul>
          </div>
        </div>
        <p className="fa-note">Rekord can build memory again from your meetings later.</p>
        <div className="fa-field">
          <label htmlFor="fa-confirm">Type forget to confirm</label>
          <input id="fa-confirm" type="text" autoComplete="off" spellCheck={false} value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void forget(); }} />
        </div>
        <div className="fa-actions">
          <button type="button" className="fa-forget" disabled={!ready || busy} onClick={() => void forget()}>Forget all memory</button>
          <button type="button" className="fa-keep" onClick={onKeep}>Keep</button>
        </div>
      </section>
    </>
  );
}

const Row = ({ title, sub, children }: { title: string; sub: string; children: ReactNode }) => (
  <div className="sm-row"><Text title={title} sub={sub} />{children}</div>
);

export default function SettingsMemory() {
  const { back, canGoBack, replace } = useRouter();
  const [memory, setMemory] = useState<MemorySettings | null>(null);
  const [model, setModel] = useState<{ state: ModelState; bytes: number }>({ state: 'none', bytes: 0 });
  const [failReason, setFailReason] = useState('');
  const [progress, setProgress] = useState<Progress>({ loaded: 0, total: 0 });
  const [size, setSize] = useState<{ items: number; bytes: number } | null>(null);
  const [plan, setPlan] = useState<ForgetPlan | null>(null);
  const [missedCard, setMissedCard] = useState(true);

  const loadSize = () => memorySize().then(setSize).catch((error) => console.error('Rekord: could not measure memory', error));
  const loadModel = async () => {
    if (settingsDev.model) return setModel(settingsDev.model);
    const state = await modelState();
    setModel({ state, bytes: state === 'ready' ? await modelBytes() : 0 });
  };

  useEffect(() => {
    getSettings().then((s) => { setMemory(s.memory); setMissedCard(s.missedMeetingCard); }).catch((error) => console.error('Rekord: could not load your settings', error));
    loadModel().catch((error) => console.error('Rekord: could not check the search model', error));
    void loadSize();
    if (settingsDev.forgetAll) void askForget();
  }, []);

  async function save(partial: Partial<MemorySettings>) {
    try {
      const s = await getSettings();
      setMemory((await updateSettings({ memory: { ...s.memory, ...partial } })).memory);
    } catch (error) {
      console.error('Rekord: could not save your settings', error);
    }
  }

  async function saveMissedCard(on: boolean) {
    setMissedCard(on);
    try {
      await updateSettings({ missedMeetingCard: on });
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
    setProgress({ loaded: 0, total: 0 });
    const res = await ensureModel(setProgress).catch((e): ModelResult => ({ ok: false, reason: e instanceof Error ? e.message : 'unknown error' }));
    setFailReason(res.ok ? '' : modelFailureText(res.reason));
    if (res.ok) await save({ searchModel: 'ready' });
    await loadModel();
  }

  async function askForget() {
    try {
      const [items, people, meetings, settings] = await Promise.all([listItems(), listPeople(), listMeetings(), getSettings()]);
      setPlan({ items: items.length, people: people.length, meetings: meetings.length, folder: settings.memory.folder });
    } catch (error) {
      console.error('Rekord: could not count your memory', error);
    }
  }

  async function forget() {
    try {
      const people = plan?.folder ? await listPeople() : [];
      await forgetAll();
      if (plan?.folder) await removePersonFiles(people.map((p) => p.id), [OPEN_LOOPS_PATH, DECISIONS_PATH]);
      refreshBadge();
    } catch (error) {
      console.error('Rekord: could not forget memory', error);
    }
    settingsDev.forgetAll = false;
    setPlan(null);
    await loadSize();
  }
  const keep = useCallback(() => { settingsDev.forgetAll = false; setPlan(null); }, []);

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
          <Toggle id="r9" title="Missed-meeting card" sub="Offers a catch up when Rekord missed a calendar meeting" on={missedCard} set={(on) => void saveMissedCard(on)} />
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
          {model.state === 'downloading' && <div className="sm-state"><ModelDownloadCard loaded={progress.loaded} total={progress.total} /></div>}
          {model.state === 'failed' && <div className="sm-state"><ModelFailedBanner reason={failReason} onRetry={() => void download()} /></div>}
          <LinkRow to="folder" title="Rekord folder" sub="Your notes as plain Markdown files" />
          <LinkRow to="move" title="Move to a new computer" sub="Save everything, bring it back later" />
          <LinkRow to="ledger" title="What left this computer" sub="Every time something was sent out" />
        </section>
        <section aria-label="Danger zone" className="sm-danger">
          <Text title="Forget all memory" sub="Keeps your meetings and transcripts" />
          <button type="button" className="sm-forget" onClick={() => void askForget()}>Forget all</button>
        </section>
        <h2 className="sm-heading">AI</h2>
        <section aria-label="AI" className="sm-card" style={{ marginBottom: 24 }}>
          <LinkRow to="settings" title="Settings" />
        </section>
      </div>
      {plan && <ForgetAllSheet plan={plan} onForget={forget} onKeep={keep} />}
    </main>
  );
}
