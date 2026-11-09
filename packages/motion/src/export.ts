import {
  BufferTarget,
  CanvasSource,
  canEncodeVideo,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
} from 'mediabunny';
import { TestScene } from './scene';
import { fontUrl } from './assets';
import { SCENE } from './check';

export interface ExportResult {
  fps: number;
  frames: number;
  seconds: number;
  renderMs: number;
  codec: string;
  bytes: number;
  peakMb: number | null;
  memorySource: string;
}

type MemoryPerformance = Performance & { memory?: { usedJSHeapSize: number } };

/** Peak memory while `work` runs: `performance.memory` sampled every 250 ms (JS heap; GPU memory is not visible to pages). */
async function peakMemory<T>(work: () => Promise<T>): Promise<{ value: T; peakMb: number | null; source: string }> {
  const perf = performance as MemoryPerformance;
  if (!perf.memory) return { value: await work(), peakMb: null, source: 'unavailable' };
  let peak = perf.memory.usedJSHeapSize;
  const timer = setInterval(() => {
    peak = Math.max(peak, perf.memory!.usedJSHeapSize);
  }, 250);
  try {
    const value = await work();
    peak = Math.max(peak, perf.memory.usedJSHeapSize);
    return { value, peakMb: Math.round(peak / 1048576), source: 'performance.memory' };
  } finally {
    clearInterval(timer);
  }
}

/** Renders the 15 s test scene at full quality and encodes it with WebCodecs, muxed by mediabunny. */
export async function exportTestScene(
  fps: 30 | 60,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportResult> {
  const { width, height, seconds, seed } = SCENE;
  const avc = await canEncodeVideo('avc', { width, height, bitrate: QUALITY_HIGH });
  const codec = avc ? 'avc' : 'vp9';
  const canvas = document.createElement('canvas');
  const run = await peakMemory(async () => {
    const scene = new TestScene(canvas, { width, height, seconds, seed, quality: 'full', fontUrl });
    await scene.ready();
    const output = new Output({
      format: avc ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
      target: new BufferTarget(),
    });
    const source = new CanvasSource(canvas, { codec, bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    const frames = seconds * fps;
    let renderMs = 0;
    const start = performance.now();
    try {
      for (let i = 0; i < frames; i++) {
        const t = performance.now();
        scene.render(i / fps, 1 / fps);
        renderMs += performance.now() - t;
        await source.add(i / fps, 1 / fps);
        if (i % fps === 0) onProgress?.(i, frames);
      }
      await output.finalize();
    } finally {
      scene.dispose();
    }
    return {
      frames,
      seconds: (performance.now() - start) / 1000,
      renderMs,
      bytes: output.target.buffer?.byteLength ?? 0,
    };
  });
  return { fps, codec, ...run.value, peakMb: run.peakMb, memorySource: run.source };
}

/** Plays the scene at reduced quality for `seconds` and returns the mean fps and p95 frame time. */
export async function previewTestScene(
  canvas: HTMLCanvasElement,
  seconds: number,
): Promise<{ meanFps: number; p95Ms: number; frames: number }> {
  const scene = new TestScene(canvas, { ...SCENE, quality: 'reduced', fontUrl });
  await scene.ready();
  const intervals: number[] = [];
  try {
    await new Promise<void>((done) => {
      let start = 0;
      let last = 0;
      const tick = (now: number) => {
        if (!start) start = last = now;
        else intervals.push(now - last);
        last = now;
        scene.render(((now - start) / 1000) % SCENE.seconds, 1 / 30);
        if (now - start < seconds * 1000) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
  } finally {
    scene.dispose();
  }
  const sorted = intervals.slice().sort((a, b) => a - b);
  const total = intervals.reduce((a, b) => a + b, 0);
  return {
    meanFps: total ? (intervals.length * 1000) / total : 0,
    p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
    frames: intervals.length,
  };
}
