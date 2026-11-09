import { exportTestScene, loadBuildingBlocks, previewTestScene } from '@appskord/motion/probe';
import { blocksVerdict, exportVerdict, failedRow, V3_ROWS, memoryVerdict, previewVerdict, V3_BUDGET, v3Row, type V3Id, type V3Row } from '@appskord/motion/check';

export type { V3Row };

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

async function preview(canvas: HTMLCanvasElement, seconds: number): Promise<V3Row> {
  const r = await previewTestScene(canvas, seconds);
  return v3Row('preview', previewVerdict(r.meanFps), round(r.meanFps), 'fps', { seconds, quality: 'reduced (540x960)', meanFps: round(r.meanFps), p95FrameMs: round(r.p95Ms), frames: r.frames });
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
export function v3Tests(canvas: HTMLCanvasElement, previewSeconds: number, onStatus: (s: string) => void): [V3Id, () => Promise<V3Row>][] {
  return [
    ['blocks', () => { peaks = []; return blocks(onStatus); }],
    ['preview', () => preview(canvas, previewSeconds)],
    ['export30', () => exportAt(30, onStatus)],
    ['export60', () => exportAt(60, onStatus)],
    ['memory', memory],
  ];
}

export { failedRow, V3_ROWS };
