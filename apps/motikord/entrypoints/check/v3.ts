import { exportTestScene, loadBuildingBlocks, previewTestScene } from '@appskord/motion/probe';
import { blocksVerdict, exportVerdict, failedRow, V3_ROWS, memoryVerdict, previewVerdict, V3_BUDGET, v3Row, type V3Id, type V3Row } from '@appskord/motion/check';
import { fontUrl } from '@appskord/motion/assets';
import { createCanvasRenderer, V3Renderer } from '@appskord/motion/renderer';
import { layerContent } from '../../components/editor/model';
import { devSampleV2 } from '../../lib/editor/v2';
import { packFinish, packLook, getPackV3 } from '../../lib/look/packs';
import { restyle } from '../../lib/restyle/restyle';

export type { V3Row };

/** The v3 rows plus "Editor preview": the editor's own reduced-quality path drawing a real clip scene. */
export type CheckId = V3Id | 'editor';
export type CheckRow = Omit<V3Row, 'id'> & { id: CheckId };
const preview = V3_ROWS.find((r) => r.id === 'preview')!;
export const CHECK_ROWS: readonly { id: CheckId; name: string; budget: string; fallback: string }[] = [
  ...V3_ROWS.slice(0, 2),
  { id: 'editor', name: 'Editor preview', budget: preview.budget, fallback: preview.fallback },
  ...V3_ROWS.slice(2),
];
export function failedCheckRow(id: CheckId, error: unknown): CheckRow {
  if (id !== 'editor') return failedRow(id, error);
  return { ...failedRow('preview', error), id, name: CHECK_ROWS[2]!.name };
}

/** CSP violations and non-extension network requests seen since the page opened: eval and remote code must stay at zero. */
const violations: string[] = [];
let blockedBlobWorkers = 0;
document.addEventListener('securitypolicyviolation', (e) => {
  // Troika probes for workers with an empty blob worker; MV3 blocks it and troika runs on the main thread, as intended.
  if (e.blockedURI.startsWith('blob:')) blockedBlobWorkers++;
  else violations.push(`${e.violatedDirective} ${e.blockedURI}`);
});
const remoteRequests = () => performance.getEntriesByType('resource').map((r) => r.name).filter((u) => !u.startsWith(location.origin) && !u.startsWith('blob:') && !u.startsWith('data:'));

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

async function blocks(onStatus: (s: string) => void): Promise<V3Row> {
  const results = await loadBuildingBlocks((name) => onStatus(`Loading ${name}`));
  const loaded = results.filter((r) => r.ok).length;
  const remote = remoteRequests();
  const clean = violations.length === 0 && remote.length === 0;
  const numbers = Object.fromEntries(results.map((r) => [r.name, `${r.ok ? 'ok' : 'FAILED'} ${r.ms} ms, ${r.detail}`]));
  return v3Row('blocks', clean ? blocksVerdict(loaded, results.length) : 'Fail', loaded, `of ${results.length} loaded`, {
    ...numbers, cspViolations: violations.join('; ') || 0, remoteRequests: remote.join(' ') || 0, blockedBlobWorkers,
  });
}

async function previewRow(canvas: HTMLCanvasElement, seconds: number): Promise<V3Row> {
  const r = await previewTestScene(canvas, seconds);
  return v3Row('preview', previewVerdict(r.meanFps), round(r.meanFps), 'fps', { seconds, quality: 'reduced (540x960)', meanFps: round(r.meanFps), p95FrameMs: round(r.p95Ms), frames: r.frames });
}

/** Plays the sample clip's first scene in the editor's preview path (V3Renderer, reduced quality) and times it. */
async function editorPreview(canvas: HTMLCanvasElement, seconds: number): Promise<CheckRow> {
  const now = Date.now();
  const clip = restyle({ id: 'check', recipe: devSampleV2('check'), history: [], createdAt: now, updatedAt: now }, { now, changeId: 'check', packId: 'studio' });
  const scene = clip.v3.scenes[0]!;
  const pack = getPackV3(clip.v3.packId);
  const gl = createCanvasRenderer(canvas);
  const view = new V3Renderer(scene, {
    width: 1080, height: 1920, quality: 'reduced', fps: 30, fontUrl, finish: packFinish(pack), look: packLook(pack),
    content: (l) => layerContent(clip, 0, l),
  });
  const intervals: number[] = [];
  try {
    view.attach(gl);
    await new Promise<void>((resolve) => {
      let start = 0;
      let last = 0;
      // requestAnimationFrame never fires in a hidden tab, so a timer also ends the run.
      const guard = setTimeout(resolve, (seconds + 20) * 1000);
      const tick = (t: number) => {
        if (!start) start = last = t;
        else intervals.push(t - last);
        last = t;
        view.render((t - start) % scene.ms);
        if (t - start < seconds * 1000) requestAnimationFrame(tick);
        else { clearTimeout(guard); resolve(); }
      };
      requestAnimationFrame(tick);
    });
  } finally {
    view.dispose();
    gl.dispose();
  }
  const total = intervals.reduce((a, b) => a + b, 0);
  const meanFps = total ? (intervals.length * 1000) / total : 0;
  const sorted = intervals.slice().sort((a, b) => a - b);
  const row = v3Row('preview', previewVerdict(meanFps), round(meanFps), 'fps', {
    seconds, quality: 'reduced (540x960)', scene: `${scene.templateId} · ${scene.layers.length} layers`, meanFps: round(meanFps), p95FrameMs: round(sorted[Math.floor(sorted.length * 0.95)] ?? 0), frames: intervals.length,
  });
  return { ...row, id: 'editor', name: CHECK_ROWS[2]!.name };
}

let peaks: { fps: number; peakMb: number | null; source: string }[] = [];

async function exportAt(fps: 30 | 60, onStatus: (s: string) => void): Promise<V3Row> {
  const r = await exportTestScene(fps, (done, total) => onStatus(`Export ${fps} fps: frame ${done} of ${total}`));
  peaks.push({ fps, peakMb: r.peakMb, source: r.memorySource });
  return v3Row(fps === 30 ? 'export30' : 'export60', exportVerdict(r.seconds, fps), round(r.seconds), 's', {
    frames: r.frames, size: '1080x1920', codec: r.codec, seconds: round(r.seconds, 2), xClipLength: round(r.seconds / 15, 2),
    renderMsPerFrame: round(r.renderMs / r.frames, 2), encodeAndWaitMsPerFrame: round((r.seconds * 1000 - r.renderMs) / r.frames, 2), megabytes: round(r.bytes / 1048576, 2),
  });
}

async function memory(): Promise<V3Row> {
  const known = peaks.filter((p) => p.peakMb !== null);
  if (!known.length) throw new Error('performance.memory is not available; run Export first');
  const peak = Math.max(...known.map((p) => p.peakMb!));
  return v3Row('memory', memoryVerdict(peak), peak, 'MB peak', {
    ...Object.fromEntries(known.map((p) => [`export${p.fps}PeakMb`, p.peakMb])), budgetMb: V3_BUDGET.memoryMb, source: `${known[0]!.source} (JS heap; GPU memory is not visible to pages)`,
  });
}

/** Runs the v3 rows in order; each row is caught on its own so one failure does not hide the rest. */
export function v3Tests(canvas: HTMLCanvasElement, previewSeconds: number, onStatus: (s: string) => void): [CheckId, () => Promise<CheckRow>][] {
  return [
    ['blocks', () => { peaks = []; return blocks(onStatus); }],
    ['preview', () => previewRow(canvas, previewSeconds)],
    ['editor', () => editorPreview(canvas, previewSeconds)],
    ['export30', () => exportAt(30, onStatus)],
    ['export60', () => exportAt(60, onStatus)],
    ['memory', memory],
  ];
}

export { failedRow, V3_ROWS };
