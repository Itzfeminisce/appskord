/** The `.briefkord` edit file: a zip of meta.json, board.json (with `from`) and files/<fileId>. Pure. */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { BOARD_VERSION, type Board } from '../board/types';
import { validateBoard } from '../board/validate';

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
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return { ok: false, error: named ? 'damaged' : 'not-briefkord' };
  }
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

  const files: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(entries)) if (path.startsWith(FILES) && path.length > FILES.length) files[path.slice(FILES.length)] = data;
  return { ok: true, pkg: { board: checked.board, from, files } };
}
