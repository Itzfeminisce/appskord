import type { PatchOp } from './types';

/** A patch that cannot apply, in plain words. */
export class PatchError extends Error {
  constructor(message: string) { super(message); this.name = 'PatchError'; }
}

type Container = Record<string, unknown> | unknown[];
const isContainer = (v: unknown): v is Container => typeof v === 'object' && v !== null;

/** Splits a JSON pointer ("/scenes/0/layers/-") into its decoded tokens. */
export function parsePointer(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/')) throw new PatchError(`The path "${path}" must start with /.`);
  const tokens = path.slice(1).split('/').map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'));
  // Blocks prototype pollution from an AI-written patch.
  if (tokens.some((t) => t === '__proto__' || t === 'constructor' || t === 'prototype')) throw new PatchError(`The path "${path}" is not allowed.`);
  return tokens;
}
const toPointer = (tokens: string[]) => tokens.map((t) => '/' + t.replace(/~/g, '~0').replace(/\//g, '~1')).join('');

function arrayIndex(token: string, max: number, path: string): number {
  if (!/^(0|[1-9]\d*)$/.test(token) || Number(token) > max) throw new PatchError(`The path "${path}" points past the end of a list.`);
  return Number(token);
}

function getAt(doc: unknown, tokens: string[], path: string): unknown {
  let node = doc;
  for (const t of tokens) {
    if (Array.isArray(node)) node = node[arrayIndex(t, node.length - 1, path)];
    else if (isContainer(node) && Object.hasOwn(node, t)) node = (node as Record<string, unknown>)[t];
    else throw new PatchError(`Nothing is at "${path}".`);
  }
  return node;
}

/** Copies every container on the way to the parent, then lets `edit` change the copied parent. Input is never touched. */
function editParent(doc: unknown, tokens: string[], path: string, edit: (parent: Container, key: string) => void): unknown {
  if (!isContainer(doc)) throw new PatchError(`Nothing is at "${path}".`);
  const copy: Container = Array.isArray(doc) ? doc.slice() : { ...doc };
  const [head, ...rest] = tokens as [string, ...string[]];
  if (rest.length === 0) {
    edit(copy, head);
    return copy;
  }
  if (Array.isArray(copy)) {
    const i = arrayIndex(head, copy.length - 1, path);
    copy[i] = editParent(copy[i], rest, path, edit);
  } else {
    if (!Object.hasOwn(copy, head)) throw new PatchError(`Nothing is at "${path}".`);
    copy[head] = editParent(copy[head], rest, path, edit);
  }
  return copy;
}

function applyOne(doc: unknown, op: PatchOp): { doc: unknown; inverse: PatchOp[] } {
  if (op.op === 'move') {
    if (op.path === op.from) return { doc, inverse: [] };
    if (op.path.startsWith(op.from + '/')) throw new PatchError(`"${op.from}" cannot move inside itself.`);
    const value = getAt(doc, parsePointer(op.from), op.from);
    const removed = applyOne(doc, { op: 'remove', path: op.from });
    const added = applyOne(removed.doc, { op: 'add', path: op.path, value });
    return { doc: added.doc, inverse: [...added.inverse, ...removed.inverse] };
  }
  const tokens = parsePointer(op.path);
  if (tokens.length === 0) {
    if (op.op === 'remove') throw new PatchError('The whole recipe cannot be removed.');
    return { doc: structuredClone(op.value), inverse: [{ op: 'replace', path: '', value: doc }] };
  }
  const parentPath = toPointer(tokens.slice(0, -1));
  let inverse: PatchOp;
  const next = editParent(doc, tokens, op.path, (parent, key) => {
    if (Array.isArray(parent)) {
      if (op.op === 'add') {
        const i = key === '-' ? parent.length : arrayIndex(key, parent.length, op.path);
        parent.splice(i, 0, structuredClone(op.value));
        inverse = { op: 'remove', path: `${parentPath}/${i}` };
      } else {
        const i = arrayIndex(key, parent.length - 1, op.path);
        const old = parent[i];
        if (op.op === 'remove') {
          parent.splice(i, 1);
          inverse = { op: 'add', path: op.path, value: old };
        } else {
          parent[i] = structuredClone(op.value);
          inverse = { op: 'replace', path: op.path, value: old };
        }
      }
      return;
    }
    const had = Object.hasOwn(parent, key);
    const old = parent[key];
    if (op.op !== 'add' && !had) throw new PatchError(`Nothing is at "${op.path}".`);
    if (op.op === 'remove') {
      delete parent[key];
      inverse = { op: 'add', path: op.path, value: old };
    } else {
      parent[key] = structuredClone(op.value);
      inverse = had ? { op: 'replace', path: op.path, value: old } : { op: 'remove', path: op.path };
    }
  });
  return { doc: next, inverse: [inverse!] };
}

/**
 * Applies a PatchOp[] (RFC 6902 subset) without mutating `doc`. Untouched branches are shared with the input.
 * Returns the new document and the ops that undo it. Throws PatchError when an op cannot apply; nothing is half-applied.
 */
export function applyPatch<T>(doc: T, ops: PatchOp[]): { doc: T; inverse: PatchOp[] } {
  let current: unknown = doc;
  const inverse: PatchOp[] = [];
  for (const op of ops) {
    const step = applyOne(current, op);
    current = step.doc;
    inverse.unshift(...step.inverse);
  }
  return { doc: current as T, inverse };
}
