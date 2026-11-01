import type { KeyName } from '../../settings';
import type { MediaSourceId } from '../../types';
import { isFreeToUse, licenceFromText, licenceName, licenceVersion } from '../licence';
import { MediaSearchError, searchOpenverse, type FetchLike, type MediaKind, type MediaResult } from '../openverse';
import { searchPexels } from '../pexels';
import { checkReply, SourceError } from './errors';
import { parseMediaWiki, parsePixabayStyle } from './parsers';

export interface SearchCtx { fetch: FetchLike; key?: string; allLicences: boolean }

export interface BuiltinSource {
  id: MediaSourceId; name: string; short: string; mono: string; blurb: string;
  /** The kind tags on the row, as the frame shows them. */ tags: string[];
  kinds: MediaKind[]; defaultOn: boolean; origins: string[];
  key?: { name: KeyName; env: string; getUrl: string };
  search(ctx: SearchCtx, q: string, kind: MediaKind): Promise<MediaResult[]>;
}

const omit = { credentials: 'omit' } as const;
async function getJson(ctx: SearchCtx, url: string, headers?: Record<string, string>): Promise<unknown> {
  let res: Response;
  try {
    res = await ctx.fetch(url, { ...omit, ...(headers ? { headers } : {}) });
  } catch {
    throw new SourceError('offline');
  }
  checkReply(res);
  try { return await res.json(); } catch { throw new SourceError('unreadable', res.status); }
}
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const s = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined);
const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const https = (u: string) => u.replace(/^http:\/\//i, 'https://');

/** Openverse and Pexels keep their own modules; their errors become SourceErrors here. */
function fromMediaSearchError(error: unknown): never {
  if (error instanceof MediaSearchError) throw new SourceError(error.reason === 'offline' ? 'offline' : error.reason === 'key' ? 'key' : error.status === 429 ? 'busy' : 'down', error.status);
  throw error;
}

// ---- Wikimedia Commons (MediaWiki API, licence from extmetadata) ----
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const FILETYPE: Record<MediaKind, string> = { image: 'bitmap', video: 'video', audio: 'audio' };
export function commonsUrl(q: string, kind: MediaKind): string {
  const p = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', origin: '*', generator: 'search', gsrnamespace: '6', gsrlimit: '24',
    gsrsearch: `${q} filetype:${FILETYPE[kind]}`, prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '1920',
    iiextmetadatafilter: 'LicenseShortName|License|LicenseUrl|Artist|ObjectName',
  });
  return `${COMMONS}?${p}`;
}
async function searchCommons(ctx: SearchCtx, q: string, kind: MediaKind): Promise<MediaResult[]> {
  const body = await getJson(ctx, commonsUrl(q, kind));
  const out = parseMediaWiki(body, { source: 'wikimedia', allLicences: ctx.allLicences }) ?? [];
  // A licence Commons does not state is left out: Motikord never guesses one for a built-in source.
  return out.filter((r) => r.licence !== 'unknown' && r.kind === kind && (kind !== 'video' || r.mime === 'video/webm' || r.mime === 'video/mp4')).map((r) => {
    if (r.kind !== 'image' || !r.thumbnail.includes('/1920px-')) return r;
    const big = (r.width ?? 0) > 1920;
    return { ...r, downloadUrl: big ? r.thumbnail : r.downloadUrl, thumbnail: r.thumbnail.replace('/1920px-', '/400px-') };
  });
}

// ---- NASA Image and Video Library ----
const NASA = 'https://images-api.nasa.gov';
export const nasaUrl = (q: string, kind: MediaKind) => `${NASA}/search?${new URLSearchParams({ q, media_type: kind, page_size: kind === 'video' ? '12' : '24' })}`;
async function searchNasa(ctx: SearchCtx, q: string, kind: MediaKind): Promise<MediaResult[]> {
  if (kind === 'audio') return [];
  const body = obj(await getJson(ctx, nasaUrl(q, kind)));
  const items = arr(obj(body.collection).items).map(obj);
  const mapped = await Promise.all(items.map(async (it): Promise<MediaResult | undefined> => {
    const d = obj(arr(it.data)[0]);
    const id = s(d.nasa_id);
    const preview = arr(it.links).map(obj).find((l) => l.rel === 'preview');
    const thumb = s(preview?.href);
    if (!id || !thumb) return undefined;
    let file: string | undefined;
    if (kind === 'image') file = https(thumb.replace('~thumb.', '~large.'));
    else {
      // Videos list their files in a manifest; the medium MP4 fits the 1080p cap.
      const manifest = s(it.href);
      if (!manifest) return undefined;
      try {
        const urls = arr(await getJson(ctx, https(manifest))).flatMap((u) => s(u) ?? []).map(https);
        file = urls.find((u) => /~medium\.mp4$/i.test(u)) ?? urls.find((u) => /~mobile\.mp4$/i.test(u)) ?? urls.find((u) => /\.mp4$/i.test(u) && !/~orig/i.test(u));
      } catch { return undefined; }
    }
    if (!file) return undefined;
    return {
      id, source: 'nasa', kind, title: s(d.title) ?? 'NASA', author: s(d.photographer) ?? s(d.secondary_creator) ?? s(d.center) ?? 'NASA',
      // NASA gives no licence per item and some are third-party: "Check you may use it", credited as From NASA Image Library.
      licence: 'unknown', licenceLabel: licenceName('unknown'), sourceName: 'NASA Image Library',
      pageUrl: `https://images.nasa.gov/details/${encodeURIComponent(id)}`, thumbnail: https(thumb), downloadUrl: file, mime: kind === 'image' ? 'image/jpeg' : 'video/mp4',
    };
  }));
  return mapped.filter((r): r is MediaResult => !!r);
}

// ---- Museums (CC0): The Met and the Art Institute of Chicago, public domain only ----
const MET = 'https://collectionapi.metmuseum.org/public/collection/v1';
const AIC = 'https://api.artic.edu/api/v1';
export const metSearchUrl = (q: string) => `${MET}/search?${new URLSearchParams({ q, hasImages: 'true', isPublicDomain: 'true' })}`;
export const aicSearchUrl = (q: string) => `${AIC}/artworks/search?${new URLSearchParams({ q, limit: '12', fields: 'id,title,artist_title,image_id,is_public_domain,thumbnail', 'query[term][is_public_domain]': 'true' })}`;
async function searchMet(ctx: SearchCtx, q: string): Promise<MediaResult[]> {
  const ids = arr(obj(await getJson(ctx, metSearchUrl(q))).objectIDs).flatMap((x) => n(x) ?? []).slice(0, 10);
  const objs = await Promise.all(ids.map((id) => getJson(ctx, `${MET}/objects/${id}`).then(obj).catch(() => undefined)));
  return objs.flatMap((o) => {
    const img = s(o?.primaryImage);
    if (!o || o.isPublicDomain !== true || !img) return [];
    return [{
      id: `met-${s(o.objectID)}`, source: 'museums' as const, kind: 'image' as const, title: s(o.title) ?? 'Artwork', author: s(o.artistDisplayName) ?? 'The Met',
      licence: 'cc0' as const, licenceLabel: licenceName('cc0'), licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', sourceName: 'The Met',
      pageUrl: s(o.objectURL) ?? img, thumbnail: s(o.primaryImageSmall) ?? img, downloadUrl: img, mime: 'image/jpeg',
    }];
  });
}
async function searchAic(ctx: SearchCtx, q: string): Promise<MediaResult[]> {
  const body = obj(await getJson(ctx, aicSearchUrl(q)));
  const iiif = s(obj(body.config).iiif_url) ?? 'https://www.artic.edu/iiif/2';
  return arr(body.data).map(obj).flatMap((a) => {
    const image = s(a.image_id);
    if (a.is_public_domain !== true || !image) return [];
    const thumb = obj(a.thumbnail);
    return [{
      id: `aic-${s(a.id)}`, source: 'museums' as const, kind: 'image' as const, title: s(a.title) ?? s(thumb.alt_text) ?? 'Artwork', author: s(a.artist_title) ?? 'Art Institute of Chicago',
      licence: 'cc0' as const, licenceLabel: licenceName('cc0'), licenceUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', sourceName: 'Art Institute of Chicago',
      pageUrl: `https://www.artic.edu/artworks/${s(a.id)}`, thumbnail: `${iiif}/${image}/full/400,/0/default.jpg`, downloadUrl: `${iiif}/${image}/full/843,/0/default.jpg`,
      mime: 'image/jpeg', width: n(thumb.width), height: n(thumb.height),
    }];
  });
}
async function searchMuseums(ctx: SearchCtx, q: string, kind: MediaKind): Promise<MediaResult[]> {
  if (kind !== 'image') return [];
  const [met, aic] = await Promise.allSettled([searchMet(ctx, q), searchAic(ctx, q)]);
  if (met.status === 'rejected' && aic.status === 'rejected') throw met.reason;
  const a = met.status === 'fulfilled' ? met.value : [];
  const b = aic.status === 'fulfilled' ? aic.value : [];
  const out: MediaResult[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) out.push(...(a[i] ? [a[i]!] : []), ...(b[i] ? [b[i]!] : []));
  return out;
}

// ---- ccMixter ----
export const ccmixterUrl = (q: string) => `https://ccmixter.org/api/query?${new URLSearchParams({ f: 'json', search: q, search_type: 'any', sort: 'rank', limit: '20' })}`;
async function searchCcmixter(ctx: SearchCtx, q: string, kind: MediaKind): Promise<MediaResult[]> {
  if (kind !== 'audio') return [];
  return arr(await getJson(ctx, ccmixterUrl(q))).map(obj).flatMap((u) => {
    const licence = licenceFromText(s(u.license_url));
    const file = arr(u.files).map(obj).find((f) => /audio\/mpeg|mp3/i.test(s(obj(f.file_format_info).mime_type) ?? s(f.download_url) ?? ''));
    const url = s(file?.download_url);
    if (!licence || !url || !isFreeToUse(licence, ctx.allLicences)) return [];
    return [{
      id: s(u.upload_id) ?? url, source: 'ccmixter' as const, kind: 'audio' as const, title: s(u.upload_name) ?? 'Untitled track', author: s(u.user_real_name) ?? s(u.user_name) ?? 'Unknown',
      licence, licenceLabel: licenceName(licence, licenceVersion(s(u.license_url))), licenceUrl: s(u.license_url) && https(s(u.license_url)!),
      pageUrl: https(s(u.file_page_url) ?? url), thumbnail: '', downloadUrl: https(url), mime: 'audio/mpeg',
    }];
  });
}

// ---- Pixabay (key in the link, as its API asks; files are downloaded, never hotlinked) ----
export const pixabayUrl = (key: string, q: string, kind: MediaKind) =>
  `https://pixabay.com/api/${kind === 'video' ? 'videos/' : ''}?${new URLSearchParams({ key, q: q.slice(0, 100), per_page: '24', safesearch: 'true' })}`;
async function searchPixabay(ctx: SearchCtx, q: string, kind: MediaKind): Promise<MediaResult[]> {
  if (kind === 'audio' || !ctx.key) return [];
  // Pixabay answers a bad key with 400 "Invalid or missing API key".
  let res: Response;
  try { res = await ctx.fetch(pixabayUrl(ctx.key, q, kind), omit); } catch { throw new SourceError('offline'); }
  if (res.status === 400) throw new SourceError('key', 400);
  checkReply(res);
  return (parsePixabayStyle(await res.json(), { source: 'pixabay', allLicences: ctx.allLicences }, 'pixabay') ?? []).filter((r) => r.kind === kind);
}

// ---- Freesound (Token header; the HQ MP3 preview, since originals need OAuth) ----
export const freesoundUrl = (q: string) =>
  `https://freesound.org/apiv2/search/text/?${new URLSearchParams({ query: q, page_size: '20', fields: 'id,name,username,license,previews,duration,url' })}`;
async function searchFreesound(ctx: SearchCtx, q: string, kind: MediaKind): Promise<MediaResult[]> {
  if (kind !== 'audio' || !ctx.key) return [];
  const body = obj(await getJson(ctx, freesoundUrl(q), { Authorization: `Token ${ctx.key}` }));
  return arr(body.results).map(obj).flatMap((r) => {
    const licence = licenceFromText(s(r.license));
    const url = s(obj(r.previews)['preview-hq-mp3']);
    if (!licence || !url || !isFreeToUse(licence, ctx.allLicences)) return [];
    return [{
      id: s(r.id) ?? url, source: 'freesound' as const, kind: 'audio' as const, title: s(r.name) ?? 'Untitled sound', author: s(r.username) ?? 'Unknown',
      licence, licenceLabel: licenceName(licence, licenceVersion(s(r.license))), licenceUrl: s(r.license) && https(s(r.license)!),
      pageUrl: s(r.url) ?? url, thumbnail: '', downloadUrl: https(url), mime: 'audio/mpeg', durationMs: n(r.duration) !== undefined ? Math.round(n(r.duration)! * 1000) : undefined,
    }];
  });
}

// ---- Jamendo (client_id in the link) ----
export const jamendoUrl = (clientId: string, q: string) =>
  `https://api.jamendo.com/v3.0/tracks/?${new URLSearchParams({ client_id: clientId, format: 'json', limit: '20', search: q, audiodownload_allowed: 'true', include: 'licenses' })}`;
async function searchJamendo(ctx: SearchCtx, q: string, kind: MediaKind): Promise<MediaResult[]> {
  if (kind !== 'audio' || !ctx.key) return [];
  const body = obj(await getJson(ctx, jamendoUrl(ctx.key, q)));
  // Jamendo reports a bad client_id in its headers block with a 200.
  const headers = obj(body.headers);
  if (headers.status === 'failed' && /client/i.test(s(headers.error_message) ?? '')) throw new SourceError('key', n(headers.code));
  return arr(body.results).map(obj).flatMap((t) => {
    const licence = licenceFromText(s(t.license_ccurl));
    const url = s(t.audiodownload) ?? s(t.audio);
    if (!licence || !url || !isFreeToUse(licence, ctx.allLicences)) return [];
    return [{
      id: s(t.id) ?? url, source: 'jamendo' as const, kind: 'audio' as const, title: s(t.name) ?? 'Untitled track', author: s(t.artist_name) ?? 'Unknown',
      licence, licenceLabel: licenceName(licence, licenceVersion(s(t.license_ccurl))), licenceUrl: s(t.license_ccurl) && https(s(t.license_ccurl)!),
      pageUrl: s(t.shareurl) ?? url, thumbnail: s(t.image) ?? '', downloadUrl: https(url), mime: 'audio/mpeg', durationMs: n(t.duration) !== undefined ? n(t.duration)! * 1000 : undefined,
    }];
  });
}

// ---- Unsplash (Client-ID header; attribution and the download ping are API terms) ----
const UTM = 'utm_source=motikord&utm_medium=referral';
export const unsplashUrl = (q: string) => `https://api.unsplash.com/search/photos?${new URLSearchParams({ query: q, per_page: '24', content_filter: 'high' })}`;
async function searchUnsplash(ctx: SearchCtx, q: string, kind: MediaKind): Promise<MediaResult[]> {
  if (kind !== 'image' || !ctx.key) return [];
  const body = obj(await getJson(ctx, unsplashUrl(q), { Authorization: `Client-ID ${ctx.key}`, 'Accept-Version': 'v1' }));
  return arr(body.results).map(obj).flatMap((p) => {
    const urls = obj(p.urls);
    const links = obj(p.links);
    const url = s(urls.regular);
    if (!url) return [];
    const page = s(links.html);
    return [{
      id: s(p.id) ?? url, source: 'unsplash' as const, kind: 'image' as const, title: s(p.description) ?? s(p.alt_description) ?? 'Unsplash photo', author: s(obj(p.user).name) ?? 'Unknown',
      licence: 'unsplash' as const, licenceLabel: licenceName('unsplash'), licenceUrl: 'https://unsplash.com/license',
      pageUrl: page ? `${page}${page.includes('?') ? '&' : '?'}${UTM}` : url, thumbnail: s(urls.small) ?? url, downloadUrl: url, mime: 'image/jpeg',
      width: n(p.width), height: n(p.height), trackUrl: s(links.download_location),
    }];
  });
}

/** Unsplash asks apps to hit download_location when a photo is used. Sends only the key; failures do not stop the add. */
export async function trackUse(fetchFn: FetchLike, r: MediaResult, key: string | undefined): Promise<void> {
  if (r.source !== 'unsplash' || !r.trackUrl || !key) return;
  try {
    await fetchFn(r.trackUrl, { ...omit, headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' } });
  } catch (error) {
    console.error('Motikord: could not tell Unsplash the photo was used', error instanceof Error ? error.name : undefined);
  }
}

/** Every built-in source, in the order Media sources lists them. Strings are the MediaSources frame's. */
export const BUILTINS: readonly BuiltinSource[] = [
  { id: 'openverse', name: 'Openverse', short: 'Openverse', mono: 'Ov', blurb: 'Openly licensed photos and music, gathered by WordPress.', tags: ['Photos', 'Music'], kinds: ['image', 'audio'], defaultOn: true,
    origins: ['https://api.openverse.org/*'],
    search: (ctx, q, kind) => (kind === 'video' ? Promise.resolve([]) : searchOpenverse(ctx.fetch, q, kind, ctx.allLicences).catch(fromMediaSearchError)) },
  { id: 'wikimedia', name: 'Wikimedia Commons', short: 'Wikimedia Commons', mono: 'Wm', blurb: 'Millions of free photos, videos and sounds.', tags: ['Photos', 'Videos', 'Music'], kinds: ['image', 'video', 'audio'], defaultOn: true,
    origins: ['https://commons.wikimedia.org/*', 'https://upload.wikimedia.org/*'], search: searchCommons },
  { id: 'nasa', name: 'NASA Image Library', short: 'NASA', mono: 'NA', blurb: 'Space and science. Mostly public domain.', tags: ['Photos', 'Videos'], kinds: ['image', 'video'], defaultOn: true,
    origins: ['https://images-api.nasa.gov/*', 'https://images-assets.nasa.gov/*'], search: searchNasa },
  { id: 'museums', name: 'Museums (CC0)', short: 'Museums (CC0)', mono: 'Mu', blurb: 'Art from The Met and the Art Institute of Chicago. Free for any use.', tags: ['Photos'], kinds: ['image'], defaultOn: false,
    origins: ['https://collectionapi.metmuseum.org/*', 'https://images.metmuseum.org/*', 'https://api.artic.edu/*', 'https://www.artic.edu/*'], search: searchMuseums },
  { id: 'ccmixter', name: 'ccMixter', short: 'ccMixter', mono: 'cc', blurb: 'Remixable music made for videos.', tags: ['Music'], kinds: ['audio'], defaultOn: false,
    origins: ['https://ccmixter.org/*'], search: searchCcmixter },
  { id: 'pexels', name: 'Pexels', short: 'Pexels', mono: 'Px', blurb: 'High-quality photos and videos. No credit needed.', tags: ['Photos', 'Videos'], kinds: ['image', 'video'], defaultOn: true,
    origins: ['https://api.pexels.com/*', 'https://images.pexels.com/*', 'https://videos.pexels.com/*'],
    key: { name: 'pexels', env: 'PEXELS_API_KEY', getUrl: 'https://www.pexels.com/api/' },
    search: (ctx, q, kind) => (kind === 'audio' || !ctx.key ? Promise.resolve([]) : searchPexels(ctx.fetch, ctx.key, q, kind).catch(fromMediaSearchError)) },
  { id: 'pixabay', name: 'Pixabay', short: 'Pixabay', mono: 'Pb', blurb: 'Photos, illustrations and videos. No credit needed.', tags: ['Photos', 'Videos'], kinds: ['image', 'video'], defaultOn: true,
    origins: ['https://pixabay.com/*', 'https://cdn.pixabay.com/*'], key: { name: 'pixabay', env: 'PIXABAY_API_KEY', getUrl: 'https://pixabay.com/api/docs/' }, search: searchPixabay },
  { id: 'freesound', name: 'Freesound', short: 'Freesound', mono: 'Fs', blurb: 'Sound effects and loops. Credit when CC BY.', tags: ['Music', 'Sounds'], kinds: ['audio'], defaultOn: true,
    origins: ['https://freesound.org/*', 'https://cdn.freesound.org/*'], key: { name: 'freesound', env: 'FREESOUND_API_KEY', getUrl: 'https://freesound.org/apiv2/apply/' }, search: searchFreesound },
  { id: 'jamendo', name: 'Jamendo', short: 'Jamendo', mono: 'Jm', blurb: 'Free music from independent artists. Credit needed.', tags: ['Music'], kinds: ['audio'], defaultOn: true,
    origins: ['https://*.jamendo.com/*'], key: { name: 'jamendo', env: 'JAMENDO_CLIENT_ID', getUrl: 'https://devportal.jamendo.com/' }, search: searchJamendo },
  { id: 'unsplash', name: 'Unsplash', short: 'Unsplash', mono: 'Us', blurb: 'Beautiful photos. Credit the photographer.', tags: ['Photos'], kinds: ['image'], defaultOn: true,
    origins: ['https://api.unsplash.com/*', 'https://images.unsplash.com/*'], key: { name: 'unsplash', env: 'UNSPLASH_ACCESS_KEY', getUrl: 'https://unsplash.com/developers' }, search: searchUnsplash },
];

export const builtin = (id: MediaSourceId): BuiltinSource => BUILTINS.find((b) => b.id === id)!;
/** On unless switched off; a key source also needs its key, which the caller checks. */
export const isOn = (on: Partial<Record<MediaSourceId, boolean>>, b: BuiltinSource): boolean => on[b.id] ?? b.defaultOn;
