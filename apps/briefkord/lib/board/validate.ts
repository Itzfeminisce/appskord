/** Checks an untrusted value (a stored board, an imported file) against the board model. Never throws. */
import { BOARD_VERSION, CARD_COLOURS, CARD_KINDS, type Board } from './types';

export type ValidateResult = { ok: true; board: Board } | { ok: false; problems: string[] };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const NODE_KINDS = ['step', 'choice', 'end', 'text'];

export function validateBoard(value: unknown): ValidateResult {
  try {
    const problems = check(value);
    return problems.length === 0 ? { ok: true, board: value as Board } : { ok: false, problems };
  } catch (error) {
    return { ok: false, problems: [`could not read the board: ${String(error)}`] };
  }
}

function check(value: unknown): string[] {
  const problems: string[] = [];
  const fail = (text: string) => problems.push(text);
  if (!isObj(value)) return ['the board is not an object'];
  if (value.version !== BOARD_VERSION) return [`unknown board version ${JSON.stringify(value.version)}`];

  findNonFinite(value, 'board', fail);
  const str = (o: Obj, key: string, at: string) => typeof o[key] === 'string' || fail(`${at}.${key} is not text`);
  const num = (o: Obj, key: string, at: string) => typeof o[key] === 'number' || fail(`${at}.${key} is not a number`);
  const list = (o: Obj, key: string, at: string): unknown[] => {
    if (Array.isArray(o[key])) return o[key] as unknown[];
    fail(`${at}.${key} is not a list`);
    return [];
  };
  const ids = (items: unknown[], at: string, seen = new Set<string>()): Obj[] => {
    const objs: Obj[] = [];
    items.forEach((item, i) => {
      if (!isObj(item) || typeof item.id !== 'string') return fail(`${at}[${i}] has no id`);
      if (seen.has(item.id)) fail(`duplicate id ${item.id} in ${at}`);
      seen.add(item.id);
      objs.push(item);
    });
    return objs;
  };

  str(value, 'id', 'board');
  str(value, 'name', 'board');
  if (typeof value.pinned !== 'boolean') fail('board.pinned is not true or false');
  num(value, 'createdAt', 'board');
  num(value, 'updatedAt', 'board');

  const boardIds = new Set<string>();
  const cards = isObj(value.cards) ? value.cards : (fail('board.cards is not an object'), {});
  for (const [key, card] of Object.entries(cards)) {
    const at = `cards.${key}`;
    if (!isObj(card)) {
      fail(`${at} is not an object`);
      continue;
    }
    if (card.id !== key) fail(`${at}.id does not match its key`);
    if (boardIds.has(key)) fail(`duplicate id ${key} in cards`);
    boardIds.add(key);
    if (!CARD_KINDS.includes(card.kind as never)) fail(`${at}.kind ${JSON.stringify(card.kind)} is unknown`);
    if (!CARD_COLOURS.includes(card.colour as never)) fail(`${at}.colour ${JSON.stringify(card.colour)} is unknown`);
    if (card.mark !== undefined && card.mark !== 'changed' && card.mark !== 'added') fail(`${at}.mark is unknown`);
    str(card, 'title', at);
    str(card, 'say', at);
    for (const k of ['z', 'createdAt', 'updatedAt']) num(card, k, at);
    if (!isObj(card.rect)) fail(`${at}.rect is missing`);
    else for (const k of ['x', 'y', 'w', 'h']) num(card.rect, k, `${at}.rect`);
    checkKind(card, at, { fail, str, num, list, ids });
  }

  const cardIds = new Set(Object.keys(cards));
  const sections = ids(list(value, 'sections', 'board'), 'sections', boardIds);
  if (Array.isArray(value.sections) && value.sections.length === 0) fail('the board has no section');
  const placed = new Map<string, string>();
  for (const s of sections) {
    str(s, 'title', `section ${s.id}`);
    num(s, 'minutes', `section ${s.id}`);
    for (const id of list(s, 'cards', `section ${s.id}`)) {
      if (typeof id !== 'string' || !cardIds.has(id)) fail(`section ${s.id} names missing card ${String(id)}`);
      else if (placed.has(id)) fail(`card ${id} is in two sections (${placed.get(id)} and ${s.id})`);
      else placed.set(id, s.id as string);
    }
  }
  for (const id of cardIds) if (!placed.has(id)) fail(`card ${id} is in no section`);

  for (const a of ids(list(value, 'arrows', 'board'), 'arrows', boardIds)) {
    for (const end of ['from', 'to']) {
      if (typeof a[end] !== 'string' || !cardIds.has(a[end] as string)) fail(`arrow ${a.id} names missing card ${String(a[end])}`);
    }
    if (a.dashed !== undefined && typeof a.dashed !== 'boolean') fail(`arrow ${a.id}.dashed is not true or false`);
  }
  for (const g of ids(list(value, 'groups', 'board'), 'groups', boardIds)) {
    str(g, 'title', `group ${g.id}`);
    for (const id of list(g, 'cards', `group ${g.id}`)) {
      if (typeof id !== 'string' || !cardIds.has(id)) fail(`group ${g.id} names missing card ${String(id)}`);
    }
  }
  for (const card of Object.values(cards)) {
    if (!isObj(card) || card.kind !== 'diagram' || !isObj(card.diagram) || !Array.isArray(card.diagram.nodes)) continue;
    for (const node of card.diagram.nodes as unknown[]) {
      if (isObj(node) && node.card !== undefined && (typeof node.card !== 'string' || !cardIds.has(node.card))) {
        fail(`diagram node ${String(node.id)} in card ${String(card.id)} names missing card ${String(node.card)}`);
      }
    }
  }

  if (value.imported !== undefined) {
    if (!isObj(value.imported)) fail('board.imported is not an object');
    else {
      str(value.imported, 'person', 'board.imported');
      for (const k of ['at', 'changed', 'added']) num(value.imported, k, 'board.imported');
    }
  }
  return problems;
}

interface Checks {
  fail: (text: string) => void;
  str: (o: Obj, key: string, at: string) => void;
  num: (o: Obj, key: string, at: string) => void;
  list: (o: Obj, key: string, at: string) => unknown[];
  ids: (items: unknown[], at: string, seen?: Set<string>) => Obj[];
}

function checkFileRef(value: unknown, at: string, { fail, str, num }: Checks): void {
  if (!isObj(value)) return void fail(`${at} is missing`);
  for (const k of ['id', 'name', 'mime']) str(value, k, at);
  num(value, 'size', at);
}

function checkKind(card: Obj, at: string, c: Checks): void {
  const { fail, str, num, list, ids } = c;
  switch (card.kind) {
    case 'link':
      for (const k of ['url', 'site', 'text']) str(card, k, at);
      for (const k of ['words', 'savedAt']) num(card, k, at);
      if (card.preview !== undefined) checkFileRef(card.preview, `${at}.preview`, c);
      return;
    case 'image':
      checkFileRef(card.file, `${at}.file`, c);
      if (card.pageUrl !== undefined) str(card, 'pageUrl', at);
      return;
    case 'file':
      checkFileRef(card.file, `${at}.file`, c);
      if (card.pages !== undefined) num(card, 'pages', at);
      return;
    case 'note':
      str(card, 'text', at);
      if (card.summary !== undefined) {
        if (!isObj(card.summary)) fail(`${at}.summary is not an object`);
        else {
          for (const k of ['of', 'model', 'provider']) str(card.summary, k, `${at}.summary`);
          num(card.summary, 'from', `${at}.summary`);
        }
      }
      return;
    case 'checklist':
      for (const item of ids(list(card, 'items', at), `${at}.items`)) {
        str(item, 'text', `${at}.items.${item.id}`);
        if (typeof item.done !== 'boolean') fail(`${at}.items.${item.id}.done is not true or false`);
      }
      return;
    case 'diagram': {
      if (!isObj(card.diagram)) return void fail(`${at}.diagram is missing`);
      const d = card.diagram;
      const diagramIds = new Set<string>();
      const nodeIds = new Set<string>();
      for (const n of ids(list(d, 'nodes', `${at}.diagram`), `${at}.diagram`, diagramIds)) {
        nodeIds.add(n.id as string);
        if (!NODE_KINDS.includes(n.kind as string)) fail(`${at} node ${n.id} kind is unknown`);
        if (!CARD_COLOURS.includes(n.colour as never)) fail(`${at} node ${n.id} colour is unknown`);
        str(n, 'label', `${at} node ${n.id}`);
        for (const k of ['x', 'y', 'w', 'h']) num(n, k, `${at} node ${n.id}`);
      }
      for (const e of ids(list(d, 'edges', `${at}.diagram`), `${at}.diagram`, diagramIds)) {
        for (const end of ['from', 'to']) {
          if (typeof e[end] !== 'string' || !nodeIds.has(e[end] as string)) fail(`${at} edge ${e.id} names missing node ${String(e[end])}`);
        }
        if (e.label !== undefined) str(e, 'label', `${at} edge ${e.id}`);
      }
    }
  }
}

/** Reports every number in the value that is NaN or infinite. */
function findNonFinite(value: unknown, at: string, fail: (text: string) => void): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`${at} is not a finite number`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findNonFinite(v, `${at}[${i}]`, fail));
  } else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) findNonFinite(v, `${at}.${k}`, fail);
  }
}
