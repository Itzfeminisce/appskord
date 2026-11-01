import type { CustomFormat, CustomSource, KeyPlacement } from '../../types';
import type { FetchLike, MediaKind, MediaResult } from '../openverse';
import { readResults } from './parsers';
import { SourceError } from './errors';

/** "Send the key as" options, in the frame's order. */
export const KEY_PLACEMENTS: [KeyPlacement, string][] = [
  ['bearer', 'Header: Authorization: Bearer'], ['authorization', 'Header: Authorization'], ['key', 'Link part: ?key='],
  ['api_key', 'Link part: ?api_key='], ['client_id', 'Link part: ?client_id='], ['header', 'Another header…'],
];

/** The link with {query}; adds ?q= or &q= when the user left it out. Undefined when it is not an https link. */
export function normaliseLink(link: string): string | undefined {
  const t = link.trim();
  let u: URL;
  try { u = new URL(t.replace('{query}', 'QUERY')); } catch { return undefined; }
  if (u.protocol !== 'https:' || !u.hostname.includes('.')) return undefined;
  if (t.includes('{query}')) return t;
  return `${t}${t.includes('?') ? (/[?&]$/.test(t) ? '' : '&') : '?'}q={query}`;
}

export const linkHost = (link: string): string => { try { return new URL(link.replace('{query}', 'x')).hostname; } catch { return ''; } };
/** "photos.mybakery.com/wp-json/wp/v2/media", as the row shows it. */
export const linkHostPath = (link: string): string => { try { const u = new URL(link.replace('{query}', 'x')); return `${u.hostname}${u.pathname.replace(/\/$/, '')}`; } catch { return link; } };
export const linkOrigin = (link: string): string => { try { return `${new URL(link.replace('{query}', 'x')).origin}/*`; } catch { return ''; } };

export interface KeySpec { keyAs?: KeyPlacement; keyHeader?: string }

/** The request for one search: words in place of {query}, the key where the user said to send it. */
export function buildRequest(link: string, query: string, key?: string, spec: KeySpec = {}): { url: string; headers: Record<string, string> } {
  const url = new URL(link.split('{query}').join(encodeURIComponent(query)));
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (key) {
    switch (spec.keyAs ?? 'bearer') {
      case 'bearer': headers.Authorization = `Bearer ${key}`; break;
      case 'authorization': headers.Authorization = key; break;
      case 'key': case 'api_key': case 'client_id': url.searchParams.set(spec.keyAs!, key); break;
      case 'header': if (spec.keyHeader?.trim()) headers[spec.keyHeader.trim()] = key; break;
    }
  }
  return { url: url.toString(), headers };
}

/** One search on a custom link. A 401/403 is a key problem; other errors carry the HTTP status. The URL may hold the key, so it is never logged. */
export async function fetchCustom(fetchFn: FetchLike, link: string, query: string, key: string | undefined, spec: KeySpec): Promise<unknown> {
  const { url, headers } = buildRequest(link, query, key, spec);
  let res: Response;
  try {
    res = await fetchFn(url, { headers, credentials: 'omit' });
  } catch {
    throw new SourceError('offline');
  }
  if (!res.ok) throw new SourceError(res.status === 401 || res.status === 403 ? 'key' : res.status === 429 ? 'busy' : 'down', res.status);
  try {
    return await res.json();
  } catch {
    throw new SourceError('unreadable', res.status);
  }
}

export type TestResult =
  | { kind: 'ok'; format: CustomFormat; results: MediaResult[]; licenceKnown: boolean }
  | { kind: 'no-results'; format?: CustomFormat } | { kind: 'unreadable' } | { kind: 'needs-key'; status: number } | { kind: 'not-a-link' }
  | { kind: 'down'; status?: number };

/** "Test with “bread”": one search, read in every known format. */
export async function testSource(fetchFn: FetchLike, name: string, link: string, key: string | undefined, spec: KeySpec, query = 'bread'): Promise<TestResult> {
  const normal = normaliseLink(link);
  if (!normal) return { kind: 'not-a-link' };
  let body: unknown;
  try {
    body = await fetchCustom(fetchFn, normal, query, key, spec);
  } catch (error) {
    if (error instanceof SourceError) {
      if (error.reason === 'key') return { kind: 'needs-key', status: error.status ?? 401 };
      if (error.reason === 'unreadable') return { kind: 'unreadable' };
      return { kind: 'down', status: error.status };
    }
    throw error;
  }
  const read = readResults(body, { source: 'custom', sourceName: name || linkHost(normal), allLicences: true });
  if (read.kind === 'unreadable') return { kind: 'unreadable' };
  if (read.kind === 'empty') return { kind: 'no-results', ...(read.format ? { format: read.format } : {}) };
  return { kind: 'ok', format: read.format, results: read.results, licenceKnown: read.results.some((r) => r.licence !== 'unknown') };
}

/** The kind most results are, for "Found {n} {kind}". */
export function mainKind(results: MediaResult[]): { kind: MediaKind; n: number } {
  const count = (k: MediaKind) => results.filter((r) => r.kind === k).length;
  const kind = (['image', 'video', 'audio'] as const).reduce((a, b) => (count(b) > count(a) ? b : a));
  return { kind, n: count(kind) };
}

/** Search one added source. */
export async function searchCustom(fetchFn: FetchLike, src: CustomSource, key: string | undefined, q: string, allLicences: boolean): Promise<MediaResult[]> {
  const body = await fetchCustom(fetchFn, src.url, q, key, src);
  const read = readResults(body, { source: 'custom', sourceName: src.name, allLicences }, src.format);
  return read.kind === 'ok' ? read.results.map((r) => ({ ...r, id: `${src.id}:${r.id}` })) : [];
}
