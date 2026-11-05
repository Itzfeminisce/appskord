/** Import of an edit file: always a new board, with the cards the sender changed or added marked against the user's own board. Pure. */
import type { Board, Card } from '../board/types';
import type { EditPackage, From } from './editFile';
import { importedId, mapIds, originId } from './ids';

/** {person} in the copy when the file carries no sharing name. */
export const NO_SENDER = 'A teammate';

export const senderName = (from: From): string => from.person || NO_SENDER;

/** "{name} (from {sender})"; a name that already says who it came from loses that part first. */
export function importName(name: string, sender: string): string {
  return `${name.replace(/\s*\(from [^()]*\)\s*$/, '')} (from ${sender})`;
}

/** The user's board this file was made from: the original if it is here, else the newest copy of it. */
export function findOwnBoard(boards: readonly Board[], incomingId: string): Board | undefined {
  const origin = originId(incomingId);
  const same = boards.filter((b) => originId(b.id) === origin);
  return same.find((b) => b.id === origin) ?? [...same].sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

const stable = (value: unknown): string =>
  JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v,
  );

/** What a card says, without place, time, ids and import marks; text the sender left out is not compared. */
function content(card: Card, leftOut: { say: boolean; text: boolean }): unknown {
  const { id: _id, rect: _rect, z: _z, createdAt: _c, updatedAt: _u, mark: _m, ...rest } = card as Card & Record<string, unknown>;
  const out: Record<string, unknown> = { ...rest };
  for (const key of ['file', 'preview'] as const) {
    const ref = out[key] as { name: string; mime: string; size: number } | undefined;
    if (ref) out[key] = { name: ref.name, mime: ref.mime, size: ref.size };
  }
  if (card.kind === 'diagram') out.diagram = { ...card.diagram, nodes: card.diagram.nodes.map((n) => (n.card ? { ...n, card: originId(n.card) } : n)) };
  if (leftOut.say) delete out.say;
  if (card.kind === 'link') {
    delete out.savedAt;
    if (leftOut.text) {
      delete out.text;
      delete out.words;
    }
  }
  return out;
}

/** 'added' for a card the user's board does not have, 'changed' when its content differs, else nothing. */
export function markOf(theirs: Card, own: Board | undefined): Card['mark'] {
  if (!own) return undefined;
  const mine = Object.values(own.cards).find((c) => originId(c.id) === originId(theirs.id));
  if (!mine) return 'added';
  const leftOut = { say: theirs.say === '', text: theirs.kind === 'link' && theirs.text === '' };
  return stable(content(mine, leftOut)) === stable(content(theirs, leftOut)) ? undefined : 'changed';
}

export interface ImportResult {
  board: Board;
  /** New file id -> bytes, to write under the new board. */
  files: Record<string, Uint8Array>;
}

/** The new board for an edit file: new ids, the chosen name, and, when the user has the board it came from, marks and `imported`. */
export function importBoard(pkg: EditPackage, own: Board | undefined, options: { name: string; nonce: string; now: number }): ImportResult {
  const { nonce, now } = options;
  const moved = mapIds(pkg.board, (id) => importedId(nonce, id));
  const cards: Record<string, Card> = {};
  let changed = 0;
  let added = 0;
  for (const card of Object.values(moved.cards)) {
    const { mark: _old, ...rest } = card;
    const mark = markOf(card, own);
    if (mark === 'changed') changed += 1;
    if (mark === 'added') added += 1;
    cards[card.id] = (mark ? { ...rest, mark } : rest) as Card;
  }
  const { imported: _imported, ...rest } = moved;
  const board: Board = {
    ...rest,
    name: options.name.trim() || importName(pkg.board.name, senderName(pkg.from)),
    pinned: false,
    createdAt: now,
    updatedAt: now,
    cards,
    ...(own ? { imported: { person: pkg.from.person, at: now, changed, added } } : {}),
  };
  const files: Record<string, Uint8Array> = {};
  for (const [id, bytes] of Object.entries(pkg.files)) files[importedId(nonce, id)] = bytes;
  return { board, files };
}
