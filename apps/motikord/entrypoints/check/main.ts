import { AUDIO, CODECS, EXPORT, GIF, PREVIEW, type ExportKind } from '@/lib/check/plan';
import { failed, numbersText, shapeResults, TESTS, type Numbers, type TestId, type TestResult } from '@/lib/check/results';
import { frameStats, round } from '@/lib/check/stats';
import { exportVerdict, memoryVerdict, previewVerdict, supportVerdict } from '@/lib/check/verdict';
import { drawFrame, makeImages } from './draw';
import type { RenderReply } from './render.worker';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const results: Partial<Record<TestId, TestResult>> = {};
// `?preview=5` shortens the 60 s preview test, for a quick developer run.
const previewSeconds = Number(new URLSearchParams(location.search).get('preview')) || PREVIEW.seconds;

async function machine(): Promise<Numbers> {
  const nav = navigator as Navigator & { deviceMemory?: number; userAgentData?: { brands?: { brand: string; version: string }[]; platform?: string } };
  const chrome = nav.userAgentData?.brands?.find((b) => b.brand === 'Google Chrome' || b.brand === 'Chromium');
  return {
    chrome: chrome?.version ?? navigator.userAgent,
    platform: nav.userAgentData?.platform ?? navigator.platform,
    cores: navigator.hardwareConcurrency,
    memoryGb: nav.deviceMemory ?? null,
    screen: `${screen.width}x${screen.height} @${devicePixelRatio}`,
    webgpu: await webgpu(),
  };
}

async function webgpu(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  try { return !!(await gpu?.requestAdapter()); } catch { return false; }
}

function setRow(id: TestId, verdict: string, text: string) {
  const row = $(`row-${id}`);
  const cell = row.querySelector('.verdict')!;
  cell.textContent = verdict;
  cell.className = `verdict ${verdict === 'Running' ? 'running' : verdict}`;
  row.querySelector('.lines')!.textContent = text;
}

async function preview(): Promise<TestResult> {
  const canvas = $<HTMLCanvasElement>('preview');
  const ctx = canvas.getContext('2d')!;
  const images = makeImages();
  const intervals: number[] = [];
  const drawMs: number[] = [];
  await new Promise<void>((done) => {
    let start = 0;
    let last = 0;
    const tick = (now: number) => {
      if (!start) start = last = now;
      else intervals.push(now - last);
      last = now;
      const d = performance.now();
      drawFrame(ctx, (now - start) / 1000, PREVIEW.width, PREVIEW.height, images);
      drawMs.push(performance.now() - d);
      if (now - start < previewSeconds * 1000) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });
  const s = frameStats(intervals);
  const meanDraw = drawMs.reduce((a, b) => a + b, 0) / Math.max(1, drawMs.length);
  return {
    verdict: previewVerdict(s.meanFps),
    numbers: { seconds: previewSeconds, frames: s.frames, meanFps: round(s.meanFps), p95FrameMs: round(s.p95Ms), dropped: s.dropped, meanDrawMs: round(meanDraw, 2) },
  };
}

function render(id: TestId, kind: ExportKind): Promise<TestResult> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
    const end = (r: TestResult) => { worker.terminate(); resolve(r); };
    worker.onerror = (e) => end(failed(e.message || 'The worker could not start'));
    worker.onmessage = (e: MessageEvent<RenderReply>) => {
      const m = e.data;
      if (m.type === 'progress') setRow(id, 'Running', `frame ${m.frame} of ${m.frames}`);
      else if (m.type === 'error') end(failed(m.message));
      else if (!m.supported) end({ verdict: 'Fail', numbers: { supported: false } });
      else {
        const clip = kind === 'gif' ? GIF.seconds : EXPORT.seconds;
        end({ verdict: exportVerdict(m.seconds, clip), numbers: { supported: true, seconds: round(m.seconds, 2), bytes: m.bytes, encoder: m.encoder } });
      }
    };
    worker.postMessage(kind);
  });
}

async function mixAudio(): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(AUDIO.channels, AUDIO.seconds * AUDIO.sampleRate, AUDIO.sampleRate);
  for (const [freq, gain] of [[220, 0.3], [330, 0.2], [440, 0.1]] as const) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, 0);
    g.gain.linearRampToValueAtTime(gain, 1);
    g.gain.linearRampToValueAtTime(0, AUDIO.seconds);
    osc.connect(g).connect(ctx.destination);
    osc.start();
  }
  return ctx.startRendering();
}

async function encodeAudio(buffer: AudioBuffer, codec: string): Promise<{ supported: boolean; seconds: number; bytes: number }> {
  const config: AudioEncoderConfig = { codec, sampleRate: AUDIO.sampleRate, numberOfChannels: AUDIO.channels, bitrate: 128_000 };
  if (typeof AudioEncoder === 'undefined' || !(await AudioEncoder.isConfigSupported(config).catch(() => ({ supported: false }))).supported) {
    return { supported: false, seconds: 0, bytes: 0 };
  }
  let bytes = 0;
  let failure: unknown = null;
  const enc = new AudioEncoder({ output: (c) => { bytes += c.byteLength; }, error: (e) => { failure ??= e; } });
  enc.configure(config);
  const start = performance.now();
  const block = 4800;
  for (let at = 0; at < buffer.length; at += block) {
    const n = Math.min(block, buffer.length - at);
    const planar = new Float32Array(n * AUDIO.channels);
    for (let ch = 0; ch < AUDIO.channels; ch++) planar.set(buffer.getChannelData(ch).subarray(at, at + n), ch * n);
    const data = new AudioData({ format: 'f32-planar', sampleRate: AUDIO.sampleRate, numberOfFrames: n, numberOfChannels: AUDIO.channels, timestamp: Math.round((at * 1e6) / AUDIO.sampleRate), data: planar });
    enc.encode(data);
    data.close();
  }
  await enc.flush();
  enc.close();
  if (failure) throw failure;
  return { supported: true, seconds: (performance.now() - start) / 1000, bytes };
}

async function audio(): Promise<TestResult> {
  const t = performance.now();
  const buffer = await mixAudio();
  const mixSeconds = (performance.now() - t) / 1000;
  const aac = await encodeAudio(buffer, CODECS.aac);
  const opus = await encodeAudio(buffer, CODECS.opus);
  return {
    verdict: supportVerdict(aac.supported || opus.supported),
    numbers: { mixSeconds: round(mixSeconds, 2), aac: aac.supported, aacSeconds: round(aac.seconds, 2), aacBytes: aac.bytes, opus: opus.supported, opusSeconds: round(opus.seconds, 2), opusBytes: opus.bytes },
  };
}

interface BuiltInModel { availability(): Promise<string>; create(): Promise<{ prompt(text: string): Promise<string>; destroy?(): void }> }

async function ai(): Promise<TestResult> {
  const lm = (globalThis as { LanguageModel?: BuiltInModel }).LanguageModel;
  if (!lm) return { verdict: 'Fail', numbers: { availability: 'missing' } };
  const availability = await lm.availability();
  // Only an already downloaded model is prompted; the check never starts a download.
  if (availability !== 'available') return { verdict: 'Fail', numbers: { availability } };
  const t = performance.now();
  const session = await lm.create();
  const reply = await session.prompt('Reply with one short line: hello.');
  session.destroy?.();
  return { verdict: 'Pass', numbers: { availability, promptSeconds: round((performance.now() - t) / 1000, 2), replyChars: reply.length } };
}

async function memory(): Promise<TestResult> {
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number }; measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> };
  if (perf.measureUserAgentSpecificMemory && globalThis.crossOriginIsolated) {
    const mb = (await perf.measureUserAgentSpecificMemory()).bytes / 2 ** 20;
    return { verdict: memoryVerdict(mb), numbers: { source: 'measureUserAgentSpecificMemory', usedMb: round(mb) } };
  }
  if (!perf.memory) return { verdict: 'Fail', numbers: { source: 'none' } };
  const used = perf.memory.usedJSHeapSize / 2 ** 20;
  return { verdict: memoryVerdict(used), numbers: { source: 'performance.memory', usedMb: round(used), totalMb: round(perf.memory.totalJSHeapSize / 2 ** 20) } };
}

const RUN: Record<TestId, () => Promise<TestResult>> = {
  preview,
  mp4: () => render('mp4', 'mp4'),
  webm: () => render('webm', 'webm'),
  alpha: () => render('alpha', 'alpha'),
  gif: () => render('gif', 'gif'),
  audio,
  ai,
  memory,
};

let busy = false;
async function run(id: TestId) {
  setRow(id, 'Running', '');
  let r: TestResult;
  try { r = await RUN[id](); } catch (error) { r = failed(error); }
  results[id] = r;
  setRow(id, r.verdict, numbersText(r.error ? { ...r.numbers, error: r.error } : r.numbers));
}

async function guarded(ids: readonly TestId[]) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button').forEach((b) => { b.disabled = b.id !== 'copy'; });
  for (const id of ids) {
    $('status').textContent = `Running ${TESTS.find((t) => t.id === id)!.name}`;
    await run(id);
  }
  $('status').textContent = 'Done. Press Copy results.';
  document.querySelectorAll('button').forEach((b) => { b.disabled = false; });
  busy = false;
}

const rows = $('rows');
for (const { id, name } of TESTS) {
  const tr = document.createElement('tr');
  tr.id = `row-${id}`;
  tr.innerHTML = `<td>${name}</td><td><button type="button">Run</button></td><td class="verdict"></td><td class="lines"></td>`;
  tr.querySelector('button')!.addEventListener('click', () => void guarded([id]));
  rows.append(tr);
}
for (const [k, v] of Object.entries(await machine())) {
  const tr = document.createElement('tr');
  tr.innerHTML = '<th></th><td></td>';
  tr.children[0]!.textContent = k;
  tr.children[1]!.textContent = String(v);
  $('machine').append(tr);
}

$('all').addEventListener('click', () => void guarded(TESTS.map((t) => t.id)));
$('copy').addEventListener('click', async () => {
  const text = JSON.stringify(shapeResults(await machine(), results, new Date().toISOString()), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    $('status').textContent = 'Results copied. Paste them in the thread.';
  } catch {
    $('status').textContent = 'Could not copy. Select the text below and copy it.';
    const pre = document.createElement('pre');
    pre.textContent = text;
    document.body.append(pre);
  }
});
// Results for scripted runs.
(globalThis as { motikordResults?: () => unknown }).motikordResults = async () => shapeResults(await machine(), results, new Date().toISOString());
