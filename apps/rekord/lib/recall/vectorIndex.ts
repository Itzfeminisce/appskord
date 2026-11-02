/** In-memory window index: one int8 matrix plus parallel columns, ranked without touching IndexedDB. Pure. */
import type { VectorRow } from '../memory/types';
import { DIMENSIONS } from './protocol';
import { MIN_COSINE, type WindowHit } from './search';

/** Vector hits kept before fusion; deeper ranks add almost nothing to rank fusion. */
export const TOP_HITS = 200;

export interface VectorIndex {
  ids: string[];
  /** Row to position in `meetings`. */
  meetingOf: Uint32Array;
  meetings: string[];
  atMs: Float64Array;
  endMs: Float64Array;
  /** Norm of each int8 row; the scale cancels out of cosine, so rows rank without dequantizing. */
  norms: Float32Array;
  matrix: Int8Array;
  size: number;
}

export function buildIndex(rows: Pick<VectorRow, 'id' | 'meetingId' | 'atMs' | 'endMs' | 'v'>[]): VectorIndex {
  const n = rows.length;
  const index: VectorIndex = {
    ids: new Array<string>(n), meetingOf: new Uint32Array(n), meetings: [], atMs: new Float64Array(n), endMs: new Float64Array(n),
    norms: new Float32Array(n), matrix: new Int8Array(n * DIMENSIONS), size: n,
  };
  const pos = new Map<string, number>();
  rows.forEach((r, i) => {
    let m = pos.get(r.meetingId);
    if (m === undefined) {
      m = index.meetings.push(r.meetingId) - 1;
      pos.set(r.meetingId, m);
    }
    index.ids[i] = r.id;
    index.meetingOf[i] = m;
    index.atMs[i] = r.atMs;
    index.endMs[i] = r.endMs;
    index.matrix.set(r.v.subarray(0, DIMENSIONS), i * DIMENSIONS);
    let nn = 0;
    for (let d = 0; d < DIMENSIONS; d++) nn += r.v[d]! * r.v[d]!;
    index.norms[i] = Math.sqrt(nn);
  });
  return index;
}

/** The best `top` windows of meetings in scope at or above `min` cosine, best first. */
export function rankIndex(index: VectorIndex, query: ArrayLike<number>, inScope?: Set<string>, min: number = MIN_COSINE, top: number = TOP_HITS): WindowHit[] {
  if (top <= 0) return [];
  const q = Float64Array.from({ length: DIMENSIONS }, (_, d) => query[d] ?? 0);
  let qn = 0;
  for (let d = 0; d < DIMENSIONS; d++) qn += q[d]! * q[d]!;
  qn = Math.sqrt(qn);
  if (!qn) return [];
  const allowed = Uint8Array.from(index.meetings, (m) => (!inScope || inScope.has(m) ? 1 : 0));
  const { matrix, norms, meetingOf } = index;
  // Min-heap of the best `top` rows so far: heap[0] is the weakest kept.
  const heapRow = new Int32Array(top);
  const heapScore = new Float64Array(top);
  let size = 0;
  for (let i = 0; i < index.size; i++) {
    if (!allowed[meetingOf[i]!] || !norms[i]) continue;
    const row = matrix.subarray(i * DIMENSIONS, (i + 1) * DIMENSIONS);
    let a = 0;
    let b = 0;
    let c = 0;
    let e = 0;
    // Four running sums: about twice as fast as one in V8 (DIMENSIONS is a multiple of 4).
    for (let d = 0; d < DIMENSIONS; d += 4) {
      a += q[d]! * row[d]!;
      b += q[d + 1]! * row[d + 1]!;
      c += q[d + 2]! * row[d + 2]!;
      e += q[d + 3]! * row[d + 3]!;
    }
    const score = (a + b + c + e) / (qn * norms[i]!);
    if (score < min || (size === top && score <= heapScore[0]!)) continue;
    let at: number;
    if (size < top) {
      at = size++;
      while (at > 0 && heapScore[(at - 1) >> 1]! > score) {
        heapRow[at] = heapRow[(at - 1) >> 1]!;
        heapScore[at] = heapScore[(at - 1) >> 1]!;
        at = (at - 1) >> 1;
      }
    } else {
      at = 0;
      for (;;) {
        const l = 2 * at + 1;
        if (l >= size) break;
        const c = l + 1 < size && heapScore[l + 1]! < heapScore[l]! ? l + 1 : l;
        if (heapScore[c]! >= score) break;
        heapRow[at] = heapRow[c]!;
        heapScore[at] = heapScore[c]!;
        at = c;
      }
    }
    heapRow[at] = i;
    heapScore[at] = score;
  }
  const found = Array.from({ length: size }, (_, k) => ({ i: heapRow[k]!, score: heapScore[k]! })).sort((a, b) => b.score - a.score || a.i - b.i);
  return found.map(({ i, score }) => ({
    score, row: { id: index.ids[i]!, meetingId: index.meetings[meetingOf[i]!]!, atMs: index.atMs[i]!, endMs: index.endMs[i]! },
  }));
}

/** Builds a synthetic index of `meetings` x `windows` rows and times one ranking, in ms. For the check page. */
export function timeSyntheticSearch(meetings = 500, windows = 120): { buildMs: number; searchMs: number; rows: number } {
  let seed = 42;
  const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648) * 2 - 1;
  const rows = Array.from({ length: meetings * windows }, (_, i) => ({
    id: `m${Math.floor(i / windows)}:${i % windows}`, meetingId: `m${Math.floor(i / windows)}`, atMs: (i % windows) * 30_000, endMs: (i % windows) * 30_000 + 30_000,
    v: Int8Array.from({ length: DIMENSIONS }, () => Math.round(rand() * 127)),
  }));
  const t0 = performance.now();
  const index = buildIndex(rows);
  const t1 = performance.now();
  rankIndex(index, Float32Array.from({ length: DIMENSIONS }, rand), undefined, 0);
  return { buildMs: t1 - t0, searchMs: performance.now() - t1, rows: rows.length };
}
