import type { CustomSource, MediaSettings } from '../../types';
import type { FetchLike, MediaKind, MediaResult } from '../openverse';
import { BUILTINS, isOn } from './builtins';
import { linkOrigin, searchCustom } from './custom';
import { SourceError } from './errors';

/** One source a search will ask. `needsKey` sources are listed but not searched. */
export interface SourceRun {
  id: string; name: string; origins: string[]; kinds: MediaKind[]; custom: boolean; keySource: boolean; needsKey?: boolean;
  search(fetchFn: FetchLike, q: string, kind: MediaKind, allLicences: boolean): Promise<MediaResult[]>;
}

/** The sources that are on, with the keys in hand. A key source that is on but has no key comes back with needsKey. */
export function sourceRuns(media: MediaSettings, keys: Record<string, string | undefined>): SourceRun[] {
  const runs: SourceRun[] = [];
  for (const b of BUILTINS) {
    if (!isOn(media.on, b)) continue;
    const key = b.key ? keys[b.key.name] : undefined;
    // A key source shows only once it has a key, or when it was on before (Pexels from the old settings).
    if (b.key && !key && media.on[b.id] !== true && b.id !== 'pexels') continue;
    runs.push({
      id: b.id, name: b.name, origins: b.origins, kinds: b.kinds, custom: false, keySource: !!b.key, needsKey: !!b.key && !key,
      search: (fetchFn, q, kind, allLicences) => b.search({ fetch: fetchFn, key, allLicences }, q, kind),
    });
  }
  for (const c of media.custom) if (c.on) runs.push(customRun(c, keys[`custom:${c.id}`]));
  return runs;
}

export function customRun(c: CustomSource, key: string | undefined): SourceRun {
  return {
    id: c.id, name: c.name, origins: [linkOrigin(c.url)], kinds: c.kinds, custom: true, keySource: false,
    search: (fetchFn, q, kind, allLicences) => (c.kinds.includes(kind) ? searchCustom(fetchFn, c, key, q, allLicences) : Promise.resolve([])),
  };
}

export interface SourceProblem { id: string; name: string; status?: number; custom: boolean }
export interface SearchOutcome {
  results: MediaResult[];
  down: SourceProblem[]; busy: SourceProblem[]; rejected: SourceProblem[];
  /** Every source that was asked failed to answer at all. */ offline: boolean;
}

/** Asks every run in parallel. A failing source is left out with its reason; the others still show, interleaved so no source buries another. */
export async function searchAll(runs: SourceRun[], fetchFn: FetchLike, q: string, kind: MediaKind, allLicences: boolean): Promise<SearchOutcome> {
  const asked = runs.filter((r) => !r.needsKey && r.kinds.includes(kind));
  const settled = await Promise.allSettled(asked.map((r) => r.search(fetchFn, q, kind, allLicences)));
  const out: SearchOutcome = { results: [], down: [], busy: [], rejected: [], offline: false };
  const lists: MediaResult[][] = [];
  let unreachable = 0;
  settled.forEach((s, i) => {
    const run = asked[i]!;
    if (s.status === 'fulfilled') { lists.push(s.value.filter((r) => r.kind === kind)); return; }
    const e = s.reason as unknown;
    const p: SourceProblem = { id: run.id, name: run.name, custom: run.custom, ...(e instanceof SourceError && e.status ? { status: e.status } : {}) };
    // Only the source id and status are logged; a URL may hold a key.
    console.error('Motikord: could not search free media', run.custom ? 'custom' : run.id, e instanceof SourceError ? e.reason : 'error', p.status);
    if (e instanceof SourceError && e.reason === 'offline') { unreachable++; out.down.push(p); }
    else if (e instanceof SourceError && e.reason === 'busy') out.busy.push(p);
    else if (e instanceof SourceError && e.reason === 'key' && run.keySource) out.rejected.push(p);
    else out.down.push(p);
  });
  out.offline = asked.length > 0 && unreachable === asked.length;
  const seen = new Set<string>();
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const r = l[i];
      if (!r) continue;
      const k = `${r.source}:${r.id}`;
      if (!seen.has(k)) { seen.add(k); out.results.push(r); }
    }
  }
  return out;
}

/** Every origin the runs reach, for one host request inside the search click. */
export const runOrigins = (runs: SourceRun[], kind: MediaKind): string[] => [...new Set(runs.filter((r) => !r.needsKey && r.kinds.includes(kind)).flatMap((r) => r.origins))];

/** Free media progress line: "Searching A…", "Searching A and B…", "Searching A, B and 3 more…". Names in Media sources order. */
export function searchingLine(names: string[]): string {
  if (names.length <= 1) return `Searching ${names[0] ?? ''}…`;
  if (names.length === 2) return `Searching ${names[0]} and ${names[1]}…`;
  return `Searching ${names[0]}, ${names[1]} and ${names.length - 2} more…`;
}
