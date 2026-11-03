/** Makes the view file and the edit file from a board and its OPFS files, and saves them with an <a download> link. */
import type { Board } from '@/lib/board/types';
import { packEditFile, type From } from '@/lib/share/editFile';
import { mapIds, originIds } from '@/lib/share/ids';
import { boardFiles, prepareForShare, type ShareOptions } from '@/lib/share/prepare';
import { buildViewFile, type ViewFiles } from '@/lib/share/viewFile';
import { readFile } from '@/lib/store/files';
import viewerCss from '../../viewer/viewer.css?raw';

export interface ExportStep { done: number; total: number }
interface Run { signal: AbortSignal; onProgress(step: ExportStep): void }

let renderer: Promise<string> | undefined;

/** The view file renderer, built to /viewer.js. */
export function loadRenderer(): Promise<string> {
  renderer ??= fetch(browser.runtime.getURL('/viewer.js')).then((r) => {
    if (!r.ok) throw new Error(`viewer.js ${r.status}`);
    return r.text();
  });
  renderer.catch(() => (renderer = undefined));
  return renderer;
}

/** Bytes of the page around the board: renderer and styles. */
export async function viewPageBytes(): Promise<number> {
  return (await loadRenderer()).length + viewerCss.length + 600;
}

const toDataUri = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const aborted = () => new DOMException('Export cancelled', 'AbortError');

async function eachFile<T>(board: Board, skip: ReadonlySet<string>, run: Run, read: (file: File) => Promise<T>): Promise<Record<string, T>> {
  const files = boardFiles(board).filter((f) => !skip.has(f.id));
  const out: Record<string, T> = {};
  run.onProgress({ done: 0, total: files.length + 1 });
  for (const [i, ref] of files.entries()) {
    if (run.signal.aborted) throw aborted();
    const file = await readFile(board.id, ref.id);
    if (file) out[ref.id] = await read(file);
    run.onProgress({ done: i + 1, total: files.length + 1 });
  }
  if (run.signal.aborted) throw aborted();
  return out;
}

/** The view file: one HTML page. Files in `leaveOut` stay out (their cards show without them). */
export async function makeViewFile(board: Board, options: ShareOptions, leaveOut: ReadonlySet<string>, run: Run): Promise<Blob> {
  const shared = prepareForShare(board, options);
  const js = await loadRenderer();
  const files: ViewFiles = await eachFile(board, leaveOut, run, toDataUri);
  const html = buildViewFile(js, viewerCss, shared, files, { at: Date.now() });
  if (run.signal.aborted) throw aborted();
  return new Blob([html], { type: 'text/html' });
}

/** The edit file: a .briefkord zip with origin ids, so the owner's import can match the cards. */
export async function makeEditFile(board: Board, options: ShareOptions, person: string, run: Run): Promise<Blob> {
  const bytes = await eachFile(board, new Set(), run, async (file) => new Uint8Array(await file.arrayBuffer()));
  const toOrigin = originIds(board);
  const origin = mapIds(board, toOrigin);
  const files: Record<string, Uint8Array> = {};
  for (const [id, data] of Object.entries(bytes)) files[toOrigin(id)] = data;
  const from: From = { person: person.trim(), at: Date.now() };
  const zip = packEditFile({ board: prepareForShare(origin, options), from, files });
  if (run.signal.aborted) throw aborted();
  return new Blob([zip as BlobPart], { type: 'application/octet-stream' });
}

/** Saves through the browser's downloads without the downloads permission. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
