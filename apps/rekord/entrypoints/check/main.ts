import { signInWithGoogle } from '@appskord/platform';
import { deleteMeeting, getDB, putMeeting, putSegment } from '@/lib/db';
import { GOOGLE_CLIENT_ID } from '@/lib/googleAuth';
import { extractedKey, extractMeeting } from '@/lib/memory/extract';
import { listPeople, putPerson } from '@/lib/memory/store';
import { loadKeys } from '@/lib/penv';
import { ensureModel, timeSyntheticSearch } from '@/lib/recall';
import { embedTexts } from '@/lib/recall/model';
import { quantize } from '@/lib/recall/quantize';
import { buildIndex, rankIndex } from '@/lib/recall/vectorIndex';
import { getSettings, PROVIDERS } from '@/lib/settings';
import {
  CHECKS, resultsText, scoreEmbed, scoreExtract, scoreFolder, scoreMemory, scoreNotification, scoreRecall, scoreSearch, scoreTasks,
  syntheticSegments, syntheticWindows, type CheckId, type CheckResult,
} from '@/lib/check/score';

const HINTS: Record<CheckId, string> = {
  1: 'Downloads the search model on first run, then embeds 720 windows.',
  2: 'Builds 500 meetings of vectors and times one search.',
  3: 'Run check 1 first so the model is loaded.',
  4: 'Needs an AI key in Rekord settings. Sends made-up text only.',
  5: 'Adds one window and times how long a card would take.',
  6: 'Allow notifications, then click the notification.',
  7: 'Pick a folder. Restart Chrome, open this page, press Check again.',
  8: 'Opens the Google consent page. The token is dropped at once.',
};

const results = new Map<CheckId, CheckResult>();
const rows = document.getElementById('rows')!;
const status = document.getElementById('status')!;
const $ = (id: CheckId, part: string) => document.getElementById(`c${id}-${part}`)!;

const show = (r: CheckResult) => {
  results.set(r.id, r);
  $(r.id, 'value').textContent = r.note ? `${r.value} - ${r.note}` : r.value;
  const v = $(r.id, 'verdict');
  v.textContent = r.verdict === 'go' ? 'Go' : r.verdict === 'no-go' ? 'No-go' : '';
  v.className = r.verdict ?? '';
};
const busy = (id: CheckId, text: string) => { $(id, 'value').textContent = text; $(id, 'verdict').textContent = ''; };
const fail = (id: CheckId, e: unknown) => {
  console.error('Rekord: could not run check', e);
  show({ id, verdict: 'no-go', value: 'Failed', note: (e instanceof Error ? e.message : String(e)).replace(/access_token=[^&\s]+/g, '').slice(0, 120) });
};
const secs = (ms: number) => ms / 1000;
const fmt = (n: number, d = 1) => n.toFixed(d);

async function ready(id: CheckId): Promise<boolean> {
  busy(id, 'Loading the search model...');
  if (await ensureModel((p) => busy(id, `Downloading the search model ${p.total ? Math.round((p.loaded / p.total) * 100) : 0}%`))) return true;
  show({ id, verdict: 'no-go', value: 'The search model did not load' });
  return false;
}

async function embedHour(): Promise<number> {
  const texts = syntheticWindows(720);
  const t0 = performance.now();
  for (let i = 0; i < texts.length; i += 16) {
    await embedTexts(texts.slice(i, i + 16));
    busy(1, `Embedding ${Math.min(i + 16, texts.length)} of 720`);
  }
  return performance.now() - t0;
}

const RUN: Record<number, () => Promise<void>> = {
  async 1() {
    if (!(await ready(1))) return;
    const ms = await embedHour();
    show({ id: 1, verdict: scoreEmbed(secs(ms)), value: `${fmt(secs(ms))} s`, note: '720 windows' });
  },
  async 2() {
    busy(2, 'Searching...');
    await new Promise((r) => setTimeout(r));
    const t = timeSyntheticSearch(500, 120);
    show({ id: 2, verdict: scoreSearch(t.searchMs), value: `${fmt(t.searchMs, 0)} ms`, note: `${t.rows} windows, build ${fmt(t.buildMs, 0)} ms` });
  },
  async 3() {
    const mb: (number | undefined)[] = [];
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
    if (heap !== undefined) mb.push(heap / 1_048_576);
    let agent: number | undefined;
    try {
      const m = await (performance as unknown as { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> }).measureUserAgentSpecificMemory?.();
      if (m) { agent = m.bytes / 1_048_576; mb.push(agent); }
    } catch { /* needs a cross-origin isolated page; the heap figure still counts */ }
    const text = [heap !== undefined && `heap ${fmt(heap / 1_048_576, 0)} MB`, agent !== undefined && `all ${fmt(agent, 0)} MB`].filter(Boolean).join(', ');
    show({ id: 3, verdict: scoreMemory(mb), value: text || 'No figure from this browser' });
  },
  async 4() {
    const [settings, keys] = await Promise.all([getSettings(), loadKeys()]);
    const keyName = PROVIDERS[settings.summary.provider].keyName;
    if (keyName && !keys[keyName]) return show({ id: 4, value: 'Add a key first' });
    const id = `check-${crypto.randomUUID()}`;
    busy(4, 'Extracting...');
    // Extraction adds the made-up speakers to People; the finally block puts People back as it was.
    const before = new Map((await listPeople()).map((p) => [p.id, p]));
    const t0 = performance.now();
    try {
      await putMeeting({ id, title: 'Machine check', startedAt: Date.now() - 3_600_000, endedAt: Date.now(), status: 'done', language: 'en' } as never);
      for (const s of syntheticSegments(id)) await putSegment(s);
      const r = await extractMeeting(id);
      const ms = performance.now() - t0;
      show({ id: 4, verdict: scoreExtract(secs(ms)), value: `${fmt(secs(ms))} s`, note: `${r.found} items found` });
    } finally {
      await deleteMeeting(id);
      await browser.storage.local.remove(extractedKey(id));
      const db = await getDB();
      for (const p of await listPeople()) {
        const was = before.get(p.id);
        if (!was) await db.delete('people', p.id);
        else if (JSON.stringify(was) !== JSON.stringify(p)) await putPerson(was);
      }
    }
  },
  async 5() {
    if (!(await ready(5))) return;
    busy(5, 'Timing...');
    const t0 = performance.now();
    const [q] = await embedTexts([syntheticWindows(1)[0]!]);
    const index = buildIndex([{ id: 'a:0', meetingId: 'a', atMs: 0, endMs: 30_000, ...quantize(q!) }]);
    rankIndex(index, q!, undefined, 0);
    const ms = performance.now() - t0;
    show({ id: 5, verdict: scoreRecall(secs(ms)), value: `${fmt(secs(ms), 2)} s`, note: 'one window to a ranked card' });
  },
  async 6() {
    if ((await Notification.requestPermission()) !== 'granted') return show({ id: 6, verdict: 'no-go', value: 'Notifications are blocked' });
    const n = new Notification('Rekord check', { body: 'Click this notification.' });
    busy(6, 'Waiting for a click on the notification');
    n.onclick = async () => {
      try {
        const win = await browser.windows.getCurrent();
        await (browser.sidePanel as unknown as { open(o: { windowId: number }): Promise<void> }).open({ windowId: win.id! });
        show({ id: 6, verdict: scoreNotification(true), value: 'Side panel opened' });
      } catch (e) {
        show({ id: 6, verdict: scoreNotification(false), value: 'Side panel did not open', note: e instanceof Error ? e.message : String(e) });
      }
    };
  },
  async 7() {
    const dir = await (window as unknown as { showDirectoryPicker(o: object): Promise<FileSystemDirectoryHandle> }).showDirectoryPicker({ mode: 'readwrite' });
    const file = await dir.getFileHandle('rekord-check.txt', { create: true });
    const w = await file.createWritable();
    await w.write('Rekord machine check');
    await w.close();
    await saveHandle(dir);
    show({ id: 7, value: 'Folder saved and written', note: 'Restart Chrome, then press Check again' });
  },
  async 8() {
    try {
      await signInWithGoogle({ clientId: GOOGLE_CLIENT_ID, scopes: ['https://www.googleapis.com/auth/tasks'], interactive: true });
      show({ id: 8, verdict: scoreTasks(true), value: 'Granted' });
    } catch (e) {
      show({ id: 8, verdict: scoreTasks(false), value: 'Refused', note: (e instanceof Error ? e.message : String(e)).replace(/access_token=[^&\s]+/g, '').slice(0, 120) });
    }
  },
};

const open = () => new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open('rekord-check', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('h');
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
async function saveHandle(h: FileSystemDirectoryHandle): Promise<void> {
  const db = await open();
  await new Promise<void>((res, rej) => { const t = db.transaction('h', 'readwrite'); t.objectStore('h').put(h, 'folder'); t.oncomplete = () => res(); t.onerror = () => rej(t.error); });
}
async function loadHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await open();
  return new Promise((res, rej) => { const q = db.transaction('h').objectStore('h').get('folder'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
}

async function checkFolderAgain(): Promise<void> {
  const h = await loadHandle();
  if (!h) return show({ id: 7, value: 'No saved folder. Pick one first' });
  type Perm = 'granted' | 'prompt' | 'denied';
  const handle = h as unknown as { queryPermission(o: object): Promise<Perm>; requestPermission(o: object): Promise<Perm> };
  const before = await handle.queryPermission({ mode: 'readwrite' });
  let oneClick = false;
  if (before === 'prompt') oneClick = (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  show({ id: 7, verdict: scoreFolder(before, oneClick), value: before === 'granted' ? 'Access kept, no click' : oneClick ? 'One click restored access' : 'Access not restored' });
}

for (const c of CHECKS) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${c.id}. ${c.label}<p class="hint">${HINTS[c.id]}</p></td><td>${c.target}</td><td id="c${c.id}-value">Not run</td><td id="c${c.id}-verdict"></td>
    <td><button type="button" id="c${c.id}-run">Run</button>${c.id === 7 ? ' <button type="button" id="c7-again">Check again</button>' : ''}</td>`;
  rows.append(tr);
  const button = $(c.id, 'run') as HTMLButtonElement;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await RUN[c.id]!(); } catch (e) { fail(c.id, e); } finally { button.disabled = false; }
  });
}
document.getElementById('c7-again')!.addEventListener('click', () => void checkFolderAgain().catch((e) => fail(7, e)));

document.getElementById('copy')!.addEventListener('click', async () => {
  const chrome = navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? 'Chrome';
  try {
    await navigator.clipboard.writeText(resultsText([...results.values()], chrome));
    status.textContent = ' Copied';
  } catch {
    status.textContent = ' Could not copy';
  }
});
