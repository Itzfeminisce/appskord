import { createRoot } from 'react-dom/client';
import type { Arrow, Board, Card, CardColour, FileRef } from '../../lib/board/types';
import { BOARD_VERSION, CARD_COLOURS } from '../../lib/board/types';
import { Canvas, fitCamera, boundsOf, type Camera, type CanvasHandle } from '../../lib/canvas';
import { pageImage } from '../../lib/capture/pageImage';
import { readPage } from '../../lib/capture/readPage';
import type { CaptureResult } from '../../lib/capture/result';
import { buildViewFile } from '../../lib/share/viewFile';
import viewerCss from '../viewer/viewer.css?raw';

type Status = 'pass' | 'fail' | 'running' | 'manual';
interface Row { status: Status; numbers: Record<string, unknown> }
const results: Record<string, Row> = {};
(window as unknown as { briefkordCheck: typeof results }).briefkordCheck = results;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function report(name: string, status: Status, numbers: Record<string, unknown>): void {
  results[name] = { status, numbers };
  let row = document.querySelector<HTMLTableRowElement>(`tr[data-check="${name}"]`);
  if (!row) {
    row = document.createElement('tr');
    row.dataset.check = name;
    row.append(document.createElement('td'), document.createElement('td'), document.createElement('td'));
    row.cells[0]!.textContent = name;
    row.cells[2]!.className = 'numbers';
    $('rows').append(row);
  }
  row.cells[1]!.textContent = status;
  row.cells[1]!.className = status;
  row.cells[2]!.textContent = JSON.stringify(numbers, null, 1);
}

const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? NaN;
};

// ---- Board generation ----

async function makeImage(index: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(800, 500);
  const ctx = canvas.getContext('2d')!;
  const hue = (index * 37) % 360;
  const gradient = ctx.createLinearGradient(0, 0, 800, 500);
  gradient.addColorStop(0, `hsl(${hue} 70% 60%)`);
  gradient.addColorStop(1, `hsl(${(hue + 120) % 360} 60% 35%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 800, 500);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `hsl(${(hue + i * 23) % 360} 80% ${30 + (i % 5) * 10}% / 0.5)`;
    ctx.beginPath();
    ctx.arc((i * 151) % 800, (i * 97) % 500, 20 + ((i * 13) % 70), 0, Math.PI * 2);
    ctx.fill();
  }
  // A noisy strip, like a screenshot's photo or text, so the file size is realistic.
  const noise = ctx.getImageData(0, 380, 800, 120);
  for (let i = 0; i < noise.data.length; i += 4) {
    const v = (Math.sin(i * 12.9898 + index) * 43758.5453) % 1;
    noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = Math.abs(v) * 255;
    noise.data[i + 3] = 255;
  }
  ctx.putImageData(noise, 0, 380);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 48px system-ui';
  ctx.fillText(`Screenshot ${index + 1}`, 32, 80);
  return canvas.convertToBlob({ type: 'image/png' });
}

function makeBoard(images: FileRef[], now: number): Board {
  const cards: Record<string, Card> = {};
  const ids: string[] = [];
  for (let i = 0; i < 200; i++) {
    const id = `c${i}`;
    const col = i % 20, row = Math.floor(i / 20);
    const colour: CardColour = CARD_COLOURS[i % CARD_COLOURS.length]!;
    const base = { id, title: `Card ${i + 1}`, colour, rect: { x: col * 300, y: row * 260, w: 260, h: 220 }, z: i + 1, say: i % 7 === 0 ? 'Point at the numbers here.' : '', createdAt: now, updatedAt: now };
    const kind = i % 4;
    if (kind === 0 && i / 4 < images.length) cards[id] = { ...base, kind: 'image', file: images[i / 4]!, pageUrl: 'https://example.com/' };
    else if (kind === 1) cards[id] = { ...base, kind: 'link', url: `https://example.com/page/${i}`, site: 'example.com', text: 'Long read about checkout drop-off and saved cards. '.repeat(6), words: 54, savedAt: now };
    else if (kind === 2) cards[id] = { ...base, kind: 'checklist', items: [1, 2, 3, 4].map((n) => ({ id: `${id}-${n}`, text: `Item ${n} to agree on`, done: n % 2 === 0 })) };
    else cards[id] = { ...base, kind: 'note', text: 'Drop-off at payment is 38%, up from 29% in June. Support gets 40 “card declined” tickets a week.' };
    ids.push(id);
  }
  const arrows: Arrow[] = [];
  for (let i = 0; i < 199; i += 3) arrows.push({ id: `a${i}`, from: `c${i}`, to: `c${i + 1}`, dashed: i % 2 === 0 });
  return {
    version: BOARD_VERSION, id: 'check', name: 'Machine check board', pinned: false, createdAt: now, updatedAt: now,
    cards, arrows, groups: [{ id: 'g1', title: 'First row', cards: ids.slice(0, 5) }],
    sections: [{ id: 's1', title: 'All cards', minutes: 30, cards: ids }],
  };
}

// ---- Canvas check ----

function CardView({ card, urls }: { card: Card; urls: Map<string, string> }) {
  return (
    <div className={`card ${card.colour}`}>
      <h3>{card.title}</h3>
      {card.kind === 'image' && <img src={urls.get(card.file.id)} alt="" decoding="async" draggable={false} />}
      {card.kind === 'link' && <p><b>{card.site}</b> {card.text.slice(0, 160)}</p>}
      {card.kind === 'note' && <p>{card.text}</p>}
      {card.kind === 'checklist' && <ul>{card.items.map((item) => <li key={item.id}>{item.done ? '☑' : '☐'} {item.text}</li>)}</ul>}
      {card.say && <p><i>{card.say}</i></p>}
    </div>
  );
}

async function canvasCheck(board: Board, blobs: Map<string, Blob>): Promise<void> {
  report('canvas', 'running', {});
  const stage = $('stage');
  const urls = new Map([...blobs].map(([id, blob]) => [id, URL.createObjectURL(blob)]));
  const items = Object.values(board.cards);
  const bounds = boundsOf(items.map((c) => c.rect))!;
  const handle: { current: CanvasHandle | null } = { current: null };
  const renderItem = (card: Card) => <CardView card={card} urls={urls} />;
  const start: Camera = fitCamera({ x: 0, y: 0, w: 1400, h: 560 }, { w: stage.clientWidth, h: stage.clientHeight }, 0, 0.1, 1);

  const opened = performance.now();
  createRoot(stage).render(
    <Canvas ref={(h) => { handle.current = h; }} items={items} arrows={board.arrows} renderItem={renderItem} initialCamera={start} style={{ width: '100%', height: '100%' }} />,
  );
  while (!stage.querySelector('[data-full]')) await frame();
  await Promise.all([...stage.querySelectorAll<HTMLImageElement>('[data-full] img')].map((img) => img.decode().catch(() => undefined)));
  await frame();
  await frame();
  const openMs = performance.now() - opened;

  const size = handle.current!.size();
  const deltas: number[] = [];
  let fullSum = 0;
  const t0 = await frame();
  let last = t0;
  for (;;) {
    const now = await frame();
    deltas.push(now - last);
    last = now;
    const t = (now - t0) / 5000;
    if (t >= 1) break;
    // Zoom between 0.35 and 1.25 twice while sweeping across the whole board.
    const zoom = 0.35 + 0.9 * (0.5 - 0.5 * Math.cos(t * Math.PI * 4));
    const cx = bounds.x + bounds.w * (0.5 - 0.5 * Math.cos(t * Math.PI));
    const cy = bounds.y + bounds.h * (0.5 + 0.4 * Math.sin(t * Math.PI * 3));
    handle.current!.setCamera({ x: size.w / 2 - cx * zoom, y: size.h / 2 - cy * zoom, zoom });
    fullSum += stage.querySelectorAll('[data-full]').length;
  }
  const p95 = percentile(deltas, 95);
  const numbers = {
    cards: items.length, images: blobs.size, arrows: board.arrows.length,
    openMs: round(openMs), frames: deltas.length, p95FrameMs: round(p95), p50FrameMs: round(percentile(deltas, 50)), maxFrameMs: round(Math.max(...deltas)),
    avgCardsWithContent: round(fullSum / Math.max(1, deltas.length - 1), 0), screen: `${size.w}x${size.h}`,
  };
  report('canvas', p95 < 33 && openMs < 2000 ? 'pass' : 'fail', numbers);
}

// ---- View file check ----

const toDataUri = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

async function viewFileCheck(board: Board, blobs: Map<string, Blob>): Promise<void> {
  report('view file', 'running', {});
  const started = performance.now();
  const js = await (await fetch(chrome.runtime.getURL('/viewer.js'))).text();
  const selfContained = !/(^|[;\s])import\s*[\s{*'"(]|(^|[;\s])export\s/m.test(js);
  const files: Record<string, string> = {};
  for (const [id, blob] of blobs) files[id] = await toDataUri(blob);
  const html = buildViewFile(js, viewerCss, board, files);
  const file = new Blob([html], { type: 'text/html' });
  const buildMs = performance.now() - started;

  const download = $<HTMLAnchorElement>('download');
  download.href = URL.createObjectURL(file);
  download.download = 'briefkord-check-view.html';
  download.hidden = false;

  // check-view.html is a sandboxed page: the file's inline script may run there, not in this page.
  const frameEl = $<HTMLIFrameElement>('view');
  if (!frameEl.src) await new Promise((resolve) => {
    frameEl.addEventListener('load', resolve, { once: true });
    frameEl.src = chrome.runtime.getURL('/check-view.html');
  });
  const shown = await new Promise<{ cards: number; images: number; ms: number }>((resolve) => {
    setTimeout(() => resolve({ cards: 0, images: 0, ms: 30000 }), 30000);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameEl.contentWindow || event.data?.type !== 'shown') return;
      removeEventListener('message', onMessage);
      resolve(event.data);
    };
    addEventListener('message', onMessage);
    frameEl.contentWindow!.postMessage({ type: 'show', html }, '*');
  });
  const rendered = shown.cards;
  const numbers = {
    viewerScriptKB: round(js.length / 1024), selfContained, sizeMB: round(file.size / 1048576, 2), buildMs: round(buildMs),
    rendered: rendered === 200, cardsRendered: rendered, imagesShown: shown.images, renderMs: round(shown.ms),
  };
  report('view file', selfContained && rendered === 200 && file.size < 50 * 1048576 ? 'pass' : 'fail', numbers);
}

// ---- Capture ----

const out = (text: string) => ($('capture-out').textContent = text);
const MENU_IMAGE = 'briefkord-check-image';
const MENU_PAGE = 'briefkord-check-page';

function showRead(name: string, result: CaptureResult<unknown>, numbers: (value: never) => Record<string, unknown>): void {
  if (result.ok) {
    const n = numbers(result.value as never);
    report(name, 'pass', n);
    out(JSON.stringify(n, null, 1));
  } else {
    const what = result.problem === 'no-access'
      ? 'Briefkord has no grant for this tab. Right-click the page and choose Save this page to Briefkord (check), or open the side panel and press Save there.'
      : result.problem === 'restricted'
        ? 'Chrome does not let extensions read this page (chrome://, the Web Store, other extensions).'
        : 'Reading the tab failed.';
    report(name, result.problem === 'failed' ? 'fail' : 'manual', { problem: result.problem, message: result.message, whatToDo: what });
    out(`${what}\n${result.message}`);
  }
}

const pageNumbers = (v: { title: string; url: string; words: number; text: string; previewUrl?: string }) => ({ title: v.title, url: v.url, words: v.words, previewUrl: v.previewUrl ?? null, textStart: v.text.slice(0, 80) });
const imageNumbers = (v: { bytes: number; mime: string; via: string; base64: string }) => ({ bytes: v.bytes, mime: v.mime, via: v.via, base64Chars: v.base64.length });

// Without the tabs permission addresses are hidden, so take the most recent tab that is not this page.
async function lastTab(): Promise<chrome.tabs.Tab | undefined> {
  const self = await chrome.tabs.getCurrent();
  const tabs = (await chrome.tabs.query({})).filter((tab) => tab.id !== self?.id);
  return tabs.sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

async function readLastTab(): Promise<void> {
  const tab = await lastTab();
  if (!tab?.id) return void out('Open a web page in another tab first.');
  showRead('save this page (button)', await readPage(tab.id), pageNumbers);
}

async function imageLastTab(): Promise<void> {
  const tab = await lastTab();
  if (!tab?.id) return void out('Open a web page with an image in another tab first.');
  let src: string | undefined;
  try {
    const [found] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => [...document.images].find((img) => img.naturalWidth > 0)?.currentSrc });
    src = found?.result ?? undefined;
  } catch (error) {
    return showRead('save image (button)', { ok: false, problem: /permission|cannot access/i.test(String(error)) ? 'no-access' : 'failed', message: String(error) }, imageNumbers);
  }
  if (!src) return void out('That tab has no image.');
  showRead('save image (button)', await pageImage(tab.id, src), imageNumbers);
}

// The menu lives only while this page is open; it is the check build's stand-in for T2's menu.
function setUpMenus(): void {
  const create = (props: chrome.contextMenus.CreateProperties) =>
    chrome.contextMenus.create(props, () => void chrome.runtime.lastError);
  chrome.contextMenus.remove(MENU_IMAGE, () => void chrome.runtime.lastError);
  chrome.contextMenus.remove(MENU_PAGE, () => void chrome.runtime.lastError);
  create({ id: MENU_IMAGE, title: 'Save image to Briefkord (check)', contexts: ['image'] });
  create({ id: MENU_PAGE, title: 'Save this page to Briefkord (check)', contexts: ['page'] });
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab?.id) return;
    if (info.menuItemId === MENU_IMAGE && info.srcUrl) void pageImage(tab.id, info.srcUrl).then((r) => showRead('save image (right-click)', r, imageNumbers));
    if (info.menuItemId === MENU_PAGE) void readPage(tab.id).then((r) => showRead('save this page (right-click)', r, pageNumbers));
  });
  addEventListener('pagehide', () => {
    chrome.contextMenus.remove(MENU_IMAGE, () => void chrome.runtime.lastError);
    chrome.contextMenus.remove(MENU_PAGE, () => void chrome.runtime.lastError);
  });
}

// ---- Run ----

async function runAll(): Promise<void> {
  $<HTMLButtonElement>('run').disabled = true;
  report('canvas', 'running', {});
  const started = performance.now();
  const blobs = new Map<string, Blob>();
  const refs: FileRef[] = [];
  for (let i = 0; i < 50; i++) {
    const blob = await makeImage(i);
    const ref = { id: `img${i}`, name: `screenshot-${i + 1}.png`, mime: 'image/png', size: blob.size };
    blobs.set(ref.id, blob);
    refs.push(ref);
  }
  const imagesMB = round([...blobs.values()].reduce((s, b) => s + b.size, 0) / 1048576, 2);
  report('setup', 'pass', { images: blobs.size, imagesMB, generateMs: round(performance.now() - started) });
  const board = makeBoard(refs, Date.now());
  try {
    await canvasCheck(board, blobs);
  } catch (error) {
    report('canvas', 'fail', { error: String(error) });
  }
  try {
    await viewFileCheck(board, blobs);
  } catch (error) {
    report('view file', 'fail', { error: String(error) });
  }
  document.documentElement.dataset.done = 'true';
}

report('capture', 'manual', { steps: 'Follow the Capture steps below.' });
setUpMenus();
$('run').addEventListener('click', () => void runAll());
$('read-tab').addEventListener('click', () => void readLastTab());
$('image-tab').addEventListener('click', () => void imageLastTab());
$('copy').addEventListener('click', () => {
  void navigator.clipboard.writeText(JSON.stringify({ app: 'briefkord', check: 'T0', at: new Date().toISOString(), userAgent: navigator.userAgent, results }, null, 1));
});
