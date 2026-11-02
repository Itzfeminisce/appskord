import { errorText } from '@/lib/check/results';
import { decodeVerdict, drawVerdict, encodeVerdict, keyframeBefore, memoryLine, resultsText, seekPoints, segmentVerdict, summaryRow } from '@/lib/check/v3';
import { EXPORT_SEGMENT, PREVIEW_SEGMENT, workerSegmenter, type Delegate } from '@/lib/render/segment';
import SegmentWorker from '@/lib/render/segment.worker?worker';
import type { Size, V3Row, Verdict } from '@/lib/check/v3';

const SIZES: Record<Size, { w: number; h: number; codec: string }> = {
  '720p': { w: 1280, h: 720, codec: 'avc1.4d001f' },
  '1080p': { w: 1920, h: 1080, codec: 'avc1.4d0028' },
};
const ENCODE_FRAMES = 150;
const CLIP_S = 60;
const FPS = 30;
const SEEKS = 20;
const DRAW_MS = 5000;
// A key frame every second keeps seeks short; real recordings may have sparser ones.
const GOP = FPS;

const nextTick = () => new Promise<void>((r) => setTimeout(r, 0));

function configFor(size: Size): VideoEncoderConfig {
  const { w, h, codec } = SIZES[size];
  return { codec, width: w, height: h, framerate: FPS, bitrate: size === '1080p' ? 8_000_000 : 4_000_000, hardwareAcceleration: 'prefer-hardware', avc: { format: 'avc' } };
}

// Moving gradient and blocks, so the encoder has real work.
function paint(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number, i: number) {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, `hsl(${(i * 3) % 360} 70% 45%)`);
  g.addColorStop(1, `hsl(${(i * 3 + 120) % 360} 70% 25%)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  for (let k = 0; k < 8; k++) ctx.fillRect(((i * 7 + k * 160) % (w - 120)) | 0, ((k * 90 + i * 3) % (h - 80)) | 0, 120, 80);
  ctx.font = '48px sans-serif';
  ctx.fillText(`frame ${i}`, 40, 80);
}

interface Encoded {
  chunks: EncodedVideoChunk[];
  config: VideoDecoderConfig | null;
  ms: number;
}

async function encode(size: Size, frames: number): Promise<Encoded> {
  const { w, h } = SIZES[size];
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d')!;
  const chunks: EncodedVideoChunk[] = [];
  let config: VideoDecoderConfig | null = null;
  let failure: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      chunks.push(chunk);
      if (meta?.decoderConfig) config = meta.decoderConfig;
    },
    error: (e) => (failure = e),
  });
  try {
    encoder.configure(configFor(size));
    const start = performance.now();
    for (let i = 0; i < frames; i++) {
      if (failure) throw failure;
      paint(ctx, w, h, i);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS) });
      encoder.encode(frame, { keyFrame: i % GOP === 0 });
      frame.close();
      // Keep the queue short so memory stays flat and the timing is the encoder's.
      while (encoder.encodeQueueSize > 4) await nextTick();
    }
    await encoder.flush();
    if (failure) throw failure;
    return { chunks, config, ms: performance.now() - start };
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
}

async function measureEncode(size: Size): Promise<{ row: V3Row; clip: Encoded | null }> {
  const label = `Encode H.264 ${size}30`;
  const supported = await VideoEncoder.isConfigSupported(configFor(size)).then((r) => Boolean(r.supported), () => false);
  if (!supported) {
    const v = encodeVerdict(size, false, 0, 0);
    return { row: summaryRow(label, v.verdict, `not supported with hardware preferred; target ${v.target} fps`), clip: null };
  }
  const e = await encode(size, ENCODE_FRAMES);
  const v = encodeVerdict(size, true, e.chunks.length, e.ms);
  return { row: summaryRow(label, v.verdict, `${v.fps} fps over ${e.chunks.length} frames; target ${v.target} fps`), clip: e };
}

// Decodes from the key frame before `targetUs` until the frame at `targetUs` comes out.
async function decodeTo(chunks: EncodedVideoChunk[], config: VideoDecoderConfig, targetUs: number, keyframes: number[]): Promise<{ ms: number; frame: VideoFrame | null }> {
  const from = keyframeBefore(keyframes, targetUs);
  const start = performance.now();
  let found: VideoFrame | null = null;
  let failure: unknown = null;
  const decoder = new VideoDecoder({
    output: (f) => {
      if (f.timestamp >= targetUs && !found) found = f;
      else f.close();
    },
    error: (e) => (failure = e),
  });
  try {
    decoder.configure(config);
    for (const c of chunks) {
      if (c.timestamp < from) continue;
      decoder.decode(c);
      if (c.timestamp >= targetUs) break;
    }
    await decoder.flush();
    if (failure) throw failure;
    return { ms: performance.now() - start, frame: found };
  } finally {
    if (decoder.state !== 'closed') decoder.close();
  }
}

async function measureDecode(): Promise<{ row: V3Row; frames: VideoFrame[] }> {
  const label = 'Decode 60 s 720p, first frame and seek';
  const cfg = configFor('720p');
  if (!(await VideoEncoder.isConfigSupported(cfg).then((r) => r.supported, () => false))) {
    return { row: summaryRow(label, 'miss', 'no 720p H.264 encoder to build the test clip'), frames: [] };
  }
  const clip = await encode('720p', CLIP_S * FPS);
  if (!clip.config) throw new Error('The encoder gave no decoder config');
  const keyframes = clip.chunks.filter((c) => c.type === 'key').map((c) => c.timestamp);
  const first = await decodeTo(clip.chunks, clip.config, 0, keyframes);
  first.frame?.close();
  const targets = seekPoints(Array.from({ length: SEEKS }, () => Math.random()), CLIP_S * 1e6);
  const times: number[] = [];
  for (const t of targets) {
    const r = await decodeTo(clip.chunks, clip.config, t, keyframes);
    r.frame?.close();
    times.push(r.ms);
  }
  // Keep a short run of decoded frames as the two video layers for the draw test.
  const layer = await decodeRun(clip, 30);
  const v = decodeVerdict(first.ms, times);
  return {
    row: summaryRow(label, v.verdict, `first frame ${v.firstFrameMs} ms, mean seek ${v.meanSeekMs} ms, worst ${v.worstSeekMs} ms over ${v.seeks} seeks`),
    frames: layer,
  };
}

async function decodeRun(clip: Encoded, count: number): Promise<VideoFrame[]> {
  const out: VideoFrame[] = [];
  const decoder = new VideoDecoder({ output: (f) => (out.length < count ? out.push(f) : f.close()), error: (e) => console.error('Klipkord: could not decode the layer frames', e) });
  try {
    decoder.configure(clip.config!);
    for (const c of clip.chunks.slice(0, count)) decoder.decode(c);
    await decoder.flush();
  } finally {
    if (decoder.state !== 'closed') decoder.close();
  }
  return out;
}

async function measureDraw(layers: VideoFrame[]): Promise<V3Row> {
  const label = 'Draw 2 video layers, zoom and captions, 5 s';
  if (layers.length === 0) return summaryRow(label, 'miss', 'no decoded frames to draw');
  const canvas = new OffscreenCanvas(960, 540);
  const ctx = canvas.getContext('2d')!;
  let frames = 0;
  const start = performance.now();
  while (performance.now() - start < DRAW_MS) {
    const zoom = 1 + 0.25 * Math.sin(frames / 20);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, 960, 540);
    ctx.setTransform(zoom, 0, 0, zoom, (960 * (1 - zoom)) / 2, (540 * (1 - zoom)) / 2);
    ctx.drawImage(layers[frames % layers.length]!, 0, 0, 960, 540);
    ctx.drawImage(layers[(frames + 7) % layers.length]!, 600, 340, 320, 180);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(160, 460, 640, 56);
    ctx.fillStyle = '#fff';
    ctx.font = '28px sans-serif';
    ctx.fillText('Captions are drawn like this on top', 180, 498);
    // Presenting the frame forces the draw to finish, as a real preview would.
    canvas.transferToImageBitmap().close();
    frames++;
    await nextTick();
  }
  const v = drawVerdict(frames, performance.now() - start);
  return summaryRow(label, v.verdict, `${v.fps} fps over ${frames} frames; target 30 fps`);
}

const SEGMENT_FRAMES = 40;

// A stand-in camera picture: a head and shoulders on a busy background, so the model has a person to find.
function cameraPicture(): OffscreenCanvas {
  const canvas = new OffscreenCanvas(640, 360);
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < 24; i++) {
    ctx.fillStyle = `hsl(${i * 15} 40% ${30 + (i % 4) * 10}%)`;
    ctx.fillRect((i % 6) * 107, Math.floor(i / 6) * 90, 107, 90);
  }
  ctx.fillStyle = '#E0AC88';
  ctx.beginPath();
  ctx.ellipse(320, 150, 60, 75, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#334155';
  ctx.beginPath();
  ctx.ellipse(320, 380, 170, 140, 0, Math.PI, 0);
  ctx.fill();
  return canvas;
}

async function measureSegment(): Promise<V3Row> {
  const label = 'Segmentation';
  const segmenter = workerSegmenter(() => new SegmentWorker());
  const picture = cameraPicture();
  let delegate: Delegate | null = null;
  const run = async (width: number) => {
    const height = Math.round((width * picture.height) / picture.width);
    const once = async () => {
      const small = await createImageBitmap(picture, { resizeWidth: width, resizeHeight: height });
      const done = await segmenter.segment(small);
      delegate = done.delegate;
      done.mask.close();
    };
    await once(); // the first one loads the model
    const start = performance.now();
    for (let i = 0; i < SEGMENT_FRAMES; i++) await once();
    return { frames: SEGMENT_FRAMES, ms: performance.now() - start };
  };
  try {
    const v = segmentVerdict(await run(PREVIEW_SEGMENT.width), await run(EXPORT_SEGMENT.width));
    return summaryRow(label, v.verdict, `preview ${v.previewFps} fps at ${PREVIEW_SEGMENT.width} px (target 10); export ${v.exportFps} fps at ${EXPORT_SEGMENT.width} px (target 30); ${delegate ?? '?'}`);
  } finally {
    segmenter.close();
  }
}

function memoryRow(): V3Row {
  const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  const m = memoryLine(mem ? mem.usedJSHeapSize : null);
  if (m.usedMb === null) return summaryRow('Memory', null, 'performance.memory is not available');
  return summaryRow('Memory', m.verdict, `${m.usedMb} MB JS heap now; the 1.5 GB target is for a 30-minute recording`);
}

export interface V3Handle {
  rows: () => V3Row[];
}

export function mountV3(host: HTMLElement): V3Handle {
  host.innerHTML = `
    <p>Measures this computer against the v3 editor budget. Takes about two minutes and needs no prompts.</p>
    <button type="button" data-run>Run</button> <button type="button" data-copy>Copy results</button> <span data-status role="status"></span>
    <table><thead><tr><th>Measure</th><th>Result</th><th>Numbers</th></tr></thead><tbody data-rows></tbody></table>`;
  const q = <T extends HTMLElement>(s: string) => host.querySelector(s) as T;
  const status = q('[data-status]');
  const body = q('[data-rows]');
  const run = q<HTMLButtonElement>('[data-run]');
  let rows: V3Row[] = [];

  const draw = () => {
    body.replaceChildren(
      ...rows.map((r) => {
        const tr = document.createElement('tr');
        const verdict = document.createElement('td');
        verdict.textContent = r.verdict === 'not measured' ? 'Not measured yet' : r.verdict;
        verdict.className = r.verdict === 'pass' ? 'pass' : r.verdict === 'miss' ? 'fail' : '';
        const numbers = document.createElement('td');
        numbers.className = 'lines';
        numbers.textContent = r.numbers;
        const name = document.createElement('td');
        name.textContent = r.measure;
        tr.append(name, verdict, numbers);
        return tr;
      }),
    );
  };
  const add = (row: V3Row) => {
    rows = [...rows, row];
    draw();
  };
  const attempt = async <T,>(what: string, measure: string, fn: () => Promise<T>): Promise<T | null> => {
    status.textContent = `Running: ${measure}`;
    try {
      return await fn();
    } catch (error) {
      console.error(`Klipkord: could not ${what}`, error);
      add(summaryRow(measure, 'miss' as Verdict, `Failed: ${errorText(error)}`));
      return null;
    }
  };

  async function runAll() {
    run.disabled = true;
    rows = [];
    draw();
    if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      add(summaryRow('WebCodecs', 'miss', 'VideoEncoder, VideoDecoder or OffscreenCanvas is missing in this Chrome'));
      status.textContent = 'Done.';
      run.disabled = false;
      return;
    }
    for (const size of ['720p', '1080p'] as const) {
      const r = await attempt(`measure the ${size} encode`, `Encode H.264 ${size}30`, () => measureEncode(size));
      if (r) add(r.row);
    }
    const d = await attempt('measure decode and seek', 'Decode 60 s 720p, first frame and seek', measureDecode);
    if (d) add(d.row);
    const layers = d?.frames ?? [];
    try {
      const r = await attempt('measure drawing', 'Draw 2 video layers, zoom and captions, 5 s', () => measureDraw(layers));
      if (r) add(r);
    } finally {
      layers.forEach((f) => f.close());
    }
    add(memoryRow());
    const seg = await attempt('measure segmentation', 'Segmentation', measureSegment);
    if (seg) add(seg);
    status.textContent = 'Done.';
    run.disabled = false;
  }

  run.addEventListener('click', () => void runAll());
  q('[data-copy]').addEventListener('click', async () => {
    const chrome = /Chrome\/(\d+)/.exec(navigator.userAgent)?.[1] ?? null;
    const text = resultsText(rows, { cores: navigator.hardwareConcurrency ?? null, chrome });
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Copied.';
    } catch (error) {
      console.error('Klipkord: could not copy the v3 results', error);
      status.textContent = 'Could not copy; select the text below.';
      status.append(Object.assign(document.createElement('pre'), { textContent: text }));
    }
  });
  draw();
  return { rows: () => rows };
}
