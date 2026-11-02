import { signInWithGoogle } from '@appskord/platform';
import { deleteMeeting, getDB, listSegments, putMeeting, putSegment } from '@/lib/db';
import { GOOGLE_CLIENT_ID } from '@/lib/googleAuth';
import { TELLINGS } from '@/lib/catchup/fixtures';
import { record } from '@/lib/ledger';
import { chat, LLMError } from '@/lib/llm';
import { extractedKey, extractMeeting, LEDGER_SERVICE, LEDGER_WHAT, NOT_SENT, REPLY_TOKENS } from '@/lib/memory/extract';
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
import {
  CATCHUP_CHECKS, catchupSystem, LIMIT_RETRIES, limitWaitSecs, TELLING_PAUSE_S, catchupText, coverageDelays, extractUsers, itemsFrom, matchSheet, MIC_SECONDS, scoreCoverage, scoreExtraction, scrub,
  type CatchupCheckId, type CatchupResult,
} from './catchup';
import type { RecordingReply } from '../background';

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
      const r = await retryOnLimit((x) => busy(4, x), () => extractMeeting(id));
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
    await navigator.clipboard.writeText(`${resultsText([...results.values()], chrome)}\n${catchupText([...catchupResults.values()])}`);
    status.textContent = ' Copied';
  } catch {
    status.textContent = ' Could not copy';
  }
});

// ---- Catch up (v4.1 T0) ----
const catchupResults = new Map<CatchupCheckId, CatchupResult>();
const catchupRows = document.getElementById('catchup-rows')!;
const K = (id: CatchupCheckId, part: string) => document.getElementById(`k-${id}-${part}`)!;
const showK = (r: CatchupResult) => {
  catchupResults.set(r.id, r);
  K(r.id, 'value').textContent = r.note ? `${r.value} - ${r.note}` : r.value;
  const v = K(r.id, 'verdict');
  v.textContent = r.verdict === 'go' ? 'Go' : r.verdict === 'no-go' ? 'No-go' : '';
  v.className = r.verdict ?? '';
};
const busyK = (id: CatchupCheckId, text: string) => { K(id, 'value').textContent = text; K(id, 'verdict').textContent = ''; };
/** Measured by the mic check: seconds from stopping to the first text, so the coverage check can add transcription lag. */
let micLagMs: number | undefined;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs `fn`; on an AI rate limit shows the countdown through `show` and tries again, up to LIMIT_RETRIES times. */
async function retryOnLimit<T>(show: (text: string) => void, fn: () => Promise<T>): Promise<T> {
  for (let tries = 0; ; tries++) {
    try { return await fn(); } catch (e) {
      const wait = limitWaitSecs(e);
      if (wait === undefined || tries >= LIMIT_RETRIES) throw e;
      for (let s = wait; s > 0; s--) { show(`Waiting for the AI limit... (${s} s)`); await sleep(1000); }
    }
  }
}

const K_HINTS: Record<CatchupCheckId, string> = {
  mic: 'Records 10 s from the microphone only, with no tab, then transcribes it. Needs the microphone allowed and a transcription key. The test recording is deleted.',
  extract: 'Sends three made-up tellings to your AI provider with your key. Made-up text only.',
  coverage: 'Runs on this page. No AI call.',
};

const RUN_K: Record<CatchupCheckId, () => Promise<void>> = {
  async mic() {
    busyK('mic', 'Starting the microphone...');
    const tab = await browser.tabs.getCurrent();
    const start = (await browser.runtime.sendMessage({ type: 'recording/start', tabId: tab?.id ?? -1, sources: { mic: true, tab: false } })) as RecordingReply | undefined;
    if (!start?.ok) return showK({ id: 'mic', verdict: 'no-go', value: 'Did not start', note: scrub(start?.error ?? 'No answer from the background') });
    const meetingId = start.meetingId!;
    try {
      const state = (await browser.runtime.sendMessage({ type: 'recording/get-state' })) as { micUnavailable?: boolean } | undefined;
      if (state?.micUnavailable) {
        await browser.runtime.sendMessage({ type: 'recording/stop' }).catch(() => undefined);
        return showK({ id: 'mic', verdict: 'no-go', value: 'Microphone unavailable', note: 'Allow the microphone for Rekord, then run again' });
      }
      for (let s = MIC_SECONDS; s > 0; s--) { busyK('mic', `Recording... ${s} s. Say a few sentences.`); await sleep(1000); }
      const stop = (await browser.runtime.sendMessage({ type: 'recording/stop' })) as RecordingReply | undefined;
      if (!stop?.ok) return showK({ id: 'mic', verdict: 'no-go', value: 'Did not stop cleanly', note: scrub(stop?.error ?? 'No answer from the background') });
      busyK('mic', 'Transcribing...');
      const stoppedAt = Date.now();
      const until = Date.now() + 90_000;
      let words = 0;
      while (!words && Date.now() < until) {
        await sleep(2000);
        words = (await listSegments(meetingId)).filter((x) => !x.interim).reduce((n, x) => n + x.text.trim().split(/\s+/).filter(Boolean).length, 0);
      }
      if (words) micLagMs = Math.max(0, Date.now() - stoppedAt);
      showK(words
        ? { id: 'mic', verdict: 'go', value: 'Recorded and transcribed', note: `${words} words, mic only, no tab, first text ${secs(micLagMs!).toFixed(0)} s after stop` }
        : { id: 'mic', verdict: 'no-go', value: 'No text came back', note: 'Check the microphone permission and the transcription key' });
    } finally {
      await deleteMeeting(meetingId).catch((e) => console.error('Rekord: could not delete the check recording', e));
    }
  },
  async extract() {
    const [settings, keys] = await Promise.all([getSettings(), loadKeys()]);
    const keyName = PROVIDERS[settings.summary.provider].keyName;
    if (keyName && !keys[keyName]) return showK({ id: 'extract', value: 'Add a key first' });
    const service = LEDGER_SERVICE[settings.summary.provider];
    const secrets = Object.values(keys).filter((k): k is string => typeof k === 'string');
    let matched = 0;
    let total = 0;
    const per: string[] = [];
    for (const [n, t] of TELLINGS.entries()) {
      if (n > 0) for (let s = TELLING_PAUSE_S; s > 0; s--) { busyK('extract', `Pausing between tellings... (${s} s)`); await sleep(1000); }
      const replies: string[] = [];
      const users = extractUsers(t);
      for (const [i, user] of users.entries()) {
        busyK('extract', `${t.minutes} min telling, part ${i + 1} of ${users.length}...`);
        const ask = async () => {
          let sent = true;
          try {
            return await chat([{ role: 'system', content: catchupSystem(t.startedAt) }, { role: 'user', content: user }], { json: true, maxTokens: REPLY_TOKENS });
          } catch (e) {
            sent = !(e instanceof LLMError && NOT_SENT.has(e.code));
            throw e;
          } finally {
            if (service && sent) await record({ service, what: LEDGER_WHAT });
          }
        };
        try { replies.push(await retryOnLimit((x) => busyK('extract', x), ask)); } catch (e) {
          throw new Error(scrub(e instanceof Error ? e.message : String(e), secrets));
        }
      }
      const hit = matchSheet(t.sheet, itemsFrom(replies));
      matched += hit;
      total += t.sheet.length;
      per.push(`${t.minutes} min ${hit}/${t.sheet.length}`);
    }
    showK({ id: 'extract', verdict: scoreExtraction(matched, total), value: `${matched} of ${total} match`, note: per.join(', ') });
  },
  async coverage() {
    const delays = TELLINGS.map((t) => coverageDelays(t));
    const r = scoreCoverage(delays, micLagMs);
    showK({ id: 'coverage', verdict: r.verdict, value: r.worstMs === undefined ? 'A prompt never ticked' : `slowest ${secs(r.worstMs).toFixed(0)} s`,
      note: micLagMs === undefined ? 'simulated, excludes transcription time; run the mic check to add it' : `simulated 5 s steps plus ${secs(micLagMs).toFixed(0)} s measured mic time to first text` });
  },
};

for (const c of CATCHUP_CHECKS) {
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${c.label}<p class="hint">${K_HINTS[c.id]}</p></td><td>${c.target}</td><td id="k-${c.id}-value">Not run</td><td id="k-${c.id}-verdict"></td>
    <td><button type="button" id="k-${c.id}-run">Run</button></td><td class="hint">${c.fallback}</td>`;
  catchupRows.append(tr);
  const button = document.getElementById(`k-${c.id}-run`) as HTMLButtonElement;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try { await RUN_K[c.id](); } catch (e) {
      console.error('Rekord: could not run catch up check', e);
      showK({ id: c.id, verdict: 'no-go', value: 'Failed', note: scrub(e instanceof Error ? e.message : String(e)) });
    } finally { button.disabled = false; }
  });
}
