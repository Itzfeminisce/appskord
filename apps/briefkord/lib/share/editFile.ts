/** The `.briefkord` edit file: a zip of meta.json, board.json (with `from`) and files/<fileId>. Pure. */
import { strFromU8, strToU8, unzipSync, zipSync, type UnzipFileInfo, type Zippable } from 'fflate';
import { BOARD_VERSION, type Board } from '../board/types';
import { validateBoard } from '../board/validate';
import { MAX_FILE_BYTES } from '../store/files';
import { boardFiles } from './prepare';

/** The most an edit file may hold once unpacked, and so the biggest file Import reads. */
export const MAX_EDIT_FILE_BYTES = 500 * 1024 * 1024;

export const EDIT_FILE_FORMAT = 1;
export const EDIT_FILE_EXT = '.briefkord';

export interface From { person: string; at: number }

export interface EditPackage {
  board: Board;
  from: From;
  /** File id -> bytes. */
  files: Record<string, Uint8Array>;
}

export type UnpackError = 'not-briefkord' | 'damaged' | 'newer-version';
export type UnpackResult = { ok: true; pkg: EditPackage } | { ok: false; error: UnpackError; problems?: string[] };

const FILES = 'files/';

export function packEditFile({ board, from, files }: EditPackage): Uint8Array {
  const zip: Zippable = {
    'meta.json': strToU8(JSON.stringify({ app: 'briefkord', format: EDIT_FILE_FORMAT })),
    'board.json': strToU8(JSON.stringify({ ...board, from })),
  };
  // Images and PDFs are compressed already; storing them keeps packing fast.
  for (const [id, bytes] of Object.entries(files)) zip[`${FILES}${id}`] = [bytes, { level: 0 }];
  return zipSync(zip, { level: 6 });
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parse(bytes: Uint8Array | undefined): unknown {
  if (!bytes) return undefined;
  try {
    return JSON.parse(strFromU8(bytes));
  } catch {
    return undefined;
  }
}

/** Reads an edit file. `named` is true when the file's name ends in .briefkord, so a broken zip is damaged rather than foreign. */
export function unpackEditFile(bytes: Uint8Array, named = false): UnpackResult {
  if (bytes.byteLength > MAX_EDIT_FILE_BYTES) return { ok: false, error: 'damaged', problems: ['the file is bigger than an edit file can be'] };
  // Sizes come from the zip's directory; fflate never inflates an entry past its stated size, so checking them first caps memory.
  const entrySize = (f: UnzipFileInfo) => Math.max(f.size, f.originalSize);
  let tooBig = false;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (f) => {
        if (f.name !== 'meta.json' && f.name !== 'board.json') return false;
        if (entrySize(f) > MAX_FILE_BYTES) return (tooBig = true), false;
        return true;
      },
    });
  } catch {
    return { ok: false, error: named ? 'damaged' : 'not-briefkord' };
  }
  if (tooBig) return { ok: false, error: 'damaged', problems: ['board.json is too big'] };
  const meta = parse(entries['meta.json']);
  if (!isObj(meta) || meta.app !== 'briefkord') return { ok: false, error: named && entries['board.json'] ? 'damaged' : 'not-briefkord' };
  if (typeof meta.format !== 'number') return { ok: false, error: 'damaged' };
  if (meta.format > EDIT_FILE_FORMAT) return { ok: false, error: 'newer-version' };

  const raw = parse(entries['board.json']);
  if (!isObj(raw)) return { ok: false, error: 'damaged', problems: ['board.json is missing or not JSON'] };
  if (typeof raw.version === 'number' && raw.version > BOARD_VERSION) return { ok: false, error: 'newer-version' };
  const { from: rawFrom, ...board } = raw;
  const checked = validateBoard(board);
  if (!checked.ok) return { ok: false, error: 'damaged', problems: checked.problems };
  const f = isObj(rawFrom) ? rawFrom : {};
  const from: From = { person: typeof f.person === 'string' ? f.person.trim() : '', at: typeof f.at === 'number' && Number.isFinite(f.at) ? f.at : 0 };

  // Only files a card uses are read, each within the per-file limit, all within the total.
  const used = new Map(boardFiles(checked.board).map((f) => [f.id, f]));
  let total = 0;
  const problems: string[] = [];
  let stored: Record<string, Uint8Array>;
  try {
    stored = unzipSync(bytes, {
      filter: (f) => {
        const ref = f.name.startsWith(FILES) ? used.get(f.name.slice(FILES.length)) : undefined;
        if (!ref) return false;
        const size = entrySize(f);
        total += size;
        if (size > MAX_FILE_BYTES) problems.push(`${f.name} is over the per-file limit`);
        else if (total > MAX_EDIT_FILE_BYTES) problems.push('the files are over the total limit');
        return problems.length === 0;
      },
    });
  } catch {
    return { ok: false, error: 'damaged', problems: ['a file could not be unpacked'] };
  }
  const files: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(stored)) {
    const id = path.slice(FILES.length);
    if (data.byteLength !== used.get(id)!.size) problems.push(`${path} is not the size its card says`);
    files[id] = data;
  }
  if (problems.length) return { ok: false, error: 'damaged', problems };
  return { ok: true, pkg: { board: checked.board, from, files } };
}
