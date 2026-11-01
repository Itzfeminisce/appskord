import type { CustomFormat, LicenceId } from '../../types';
import { isFreeToUse, licenceFromText, licenceName, licenceVersion, openverseLicence, openverseLicenceName } from '../licence';
import type { MediaKind, MediaResult } from '../openverse';

/** Who the results are from: fills source and sourceName on every result. */
export interface From { source: MediaResult['source']; sourceName?: string; allLicences: boolean }

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const isUrl = (v: unknown): v is string => typeof v === 'string' && /^https?:\/\//i.test(v);
const https = (u: string) => u.replace(/^http:\/\//i, 'https://');
/** Strips tags and entities from the HTML that WordPress and MediaWiki put in titles and authors. */
export const plain = (html: string | undefined): string | undefined =>
  str((html ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;/g, '’').replace(/&quot;/g, '"').replace(/&[a-z]+;|&#\d+;/g, '').replace(/\s+/g, ' '));

export const kindOfMime = (mime: string | undefined): MediaKind | undefined => {
  const m = (mime ?? '').toLowerCase();
  return m.startsWith('image/') ? 'image' : m.startsWith('video/') ? 'video' : m.startsWith('audio/') ? 'audio' : undefined;
};
const EXT_KIND: Record<string, MediaKind> = {
  jpg: 'image', jpeg: 'image', png: 'image', webp: 'image', gif: 'image', avif: 'image', svg: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', mp3: 'audio', ogg: 'audio', oga: 'audio', wav: 'audio', flac: 'audio', m4a: 'audio',
};
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', m4v: 'video/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', m4a: 'audio/mp4',
};
const extOf = (url: string) => /\.([a-z0-9]{2,4})(?:$|[?#])/i.exec(url.split('?')[0] ?? '')?.[1]?.toLowerCase() ?? '';
export const kindOfUrl = (url: string): MediaKind | undefined => EXT_KIND[extOf(url)];
export const mimeOfUrl = (url: string): string | undefined => EXT_MIME[extOf(url)];

const untitled = (kind: MediaKind) => (kind === 'image' ? 'Untitled photo' : kind === 'video' ? 'Untitled video' : 'Untitled track');

/** A result whose licence the source did not give: Motikord never claims one. */
function unknownResult(from: From, r: Omit<MediaResult, 'source' | 'sourceName' | 'licence' | 'licenceLabel'>): MediaResult {
  return { ...r, source: from.source, ...(from.sourceName ? { sourceName: from.sourceName } : {}), licence: 'unknown', licenceLabel: licenceName('unknown') };
}

/** Licence from text; undefined text means "not listed" (unknown), unreadable or no-derivatives text drops the item. */
function licenceOf(text: string | undefined, from: From): { licence: LicenceId; label: string } | undefined {
  if (!text) return { licence: 'unknown', label: licenceName('unknown') };
  const licence = licenceFromText(text);
  if (!licence || !isFreeToUse(licence, from.allLicences)) return undefined;
  return { licence, label: licenceName(licence, licenceVersion(text)) };
}

// ---- Openverse API (a custom link to an Openverse instance) ----
function parseOpenverse(body: unknown, from: From): MediaResult[] | undefined {
  if (!isObj(body) || !Array.isArray(body.results) || !('result_count' in body || 'page_count' in body)) return undefined;
  return body.results.flatMap((it: unknown) => {
    if (!isObj(it) || !isUrl(it.url)) return [];
    const licence = openverseLicence(str(it.license));
    if (!licence || !isFreeToUse(licence, from.allLicences)) return [];
    const kind: MediaKind = 'duration' in it || 'audio_set' in it ? 'audio' : 'image';
    return [{
      id: str(it.id) ?? it.url, source: from.source, ...(from.sourceName ? { sourceName: from.sourceName } : {}), kind,
      title: str(it.title) ?? untitled(kind), author: str(it.creator) ?? 'Unknown',
      licence, licenceLabel: openverseLicenceName(str(it.license), licence, str(it.license_version)), licenceUrl: str(it.license_url),
      pageUrl: str(it.foreign_landing_url) ?? it.url, thumbnail: str(it.thumbnail) ?? (kind === 'image' ? it.url : ''), downloadUrl: it.url,
      mime: mimeOfUrl(it.url), width: num(it.width), height: num(it.height), durationMs: num(it.duration),
    }];
  });
}

// ---- WordPress media library (/wp-json/wp/v2/media) ----
function parseWordPress(body: unknown, from: From): MediaResult[] | undefined {
  if (!Array.isArray(body) || !body.length || !body.every((it) => isObj(it) && 'source_url' in it && 'media_type' in it)) return undefined;
  return (body as Obj[]).flatMap((it) => {
    if (!isUrl(it.source_url)) return [];
    const kind = kindOfMime(str(it.mime_type)) ?? kindOfUrl(it.source_url);
    if (!kind) return [];
    const details = isObj(it.media_details) ? it.media_details : {};
    const sizes = isObj(details.sizes) ? details.sizes : {};
    const thumb = [sizes.medium, sizes.thumbnail].find((s) => isObj(s) && isUrl(s.source_url)) as Obj | undefined;
    const title = isObj(it.title) ? plain(str(it.title.rendered)) : str(it.title);
    return [unknownResult(from, {
      id: str(it.id) ?? it.source_url, kind, title: title ?? untitled(kind), author: 'Unknown',
      pageUrl: str(it.link) ?? it.source_url, thumbnail: (thumb?.source_url as string | undefined) ?? (kind === 'image' ? it.source_url : ''),
      downloadUrl: it.source_url, mime: str(it.mime_type), width: num(details.width), height: num(details.height),
      durationMs: num(details.length) !== undefined ? num(details.length)! * 1000 : undefined,
    })];
  });
}

// ---- MediaWiki API (prop=imageinfo with extmetadata), e.g. Wikimedia Commons ----
export function parseMediaWiki(body: unknown, from: From): MediaResult[] | undefined {
  if (!isObj(body) || !isObj(body.query) || !('pages' in body.query)) return undefined;
  const pages = body.query.pages;
  const list = (Array.isArray(pages) ? pages : isObj(pages) ? Object.values(pages) : []).filter(isObj);
  list.sort((a, b) => (num(a.index) ?? 0) - (num(b.index) ?? 0));
  return list.flatMap((p) => {
    const info = Array.isArray(p.imageinfo) && isObj(p.imageinfo[0]) ? p.imageinfo[0] : undefined;
    if (!info || !isUrl(info.url)) return [];
    const kind = kindOfMime(str(info.mime)) ?? kindOfUrl(info.url);
    if (!kind) return [];
    const meta = isObj(info.extmetadata) ? info.extmetadata : {};
    const field = (k: string) => (isObj(meta[k]) ? str((meta[k] as Obj).value) : undefined);
    const lic = licenceOf(field('LicenseShortName') ?? field('License'), from);
    if (!lic) return [];
    const title = plain(field('ObjectName')) ?? str(p.title)?.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, '');
    return [{
      id: str(p.pageid) ?? info.url, source: from.source, ...(from.sourceName ? { sourceName: from.sourceName } : {}), kind,
      title: title ?? untitled(kind), author: plain(field('Artist')) ?? 'Unknown',
      licence: lic.licence, licenceLabel: field('LicenseShortName') && lic.licence !== 'unknown' ? field('LicenseShortName')! : lic.label, licenceUrl: field('LicenseUrl'),
      pageUrl: str(info.descriptionurl) ?? info.url,
      thumbnail: str(info.thumburl) ?? (kind === 'image' ? info.url : ''), downloadUrl: info.url,
      mime: str(info.mime), width: num(info.width), height: num(info.height),
      durationMs: num(info.duration) !== undefined ? Math.round(num(info.duration)! * 1000) : undefined,
    }];
  });
}

// ---- Pexels-style (photos[] with src, videos[] with video_files) ----
function parsePexelsStyle(body: unknown, from: From): MediaResult[] | undefined {
  if (!isObj(body) || !(Array.isArray(body.photos) || Array.isArray(body.videos))) return undefined;
  const photos = (Array.isArray(body.photos) ? body.photos : []).filter(isObj).flatMap((p) => {
    const src = isObj(p.src) ? p.src : {};
    const url = [src.large2x, src.large, src.original].find(isUrl);
    if (!url) return [];
    return [unknownResult(from, {
      id: str(p.id) ?? url, kind: 'image', title: str(p.alt) ?? untitled('image'), author: str(p.photographer) ?? 'Unknown',
      pageUrl: str(p.url) ?? url, thumbnail: [src.medium, src.small].find(isUrl) ?? url, downloadUrl: url, mime: mimeOfUrl(url), width: num(p.width), height: num(p.height),
    })];
  });
  const videos = (Array.isArray(body.videos) ? body.videos : []).filter(isObj).flatMap((v) => {
    const files = (Array.isArray(v.video_files) ? v.video_files : []).filter(isObj).filter((f) => isUrl(f.link) && str(f.file_type) === 'video/mp4');
    files.sort((a, b) => (num(b.width) ?? 0) - (num(a.width) ?? 0));
    const file = files.find((f) => Math.max(num(f.width) ?? 0, num(f.height) ?? 0) <= 1920) ?? files[files.length - 1];
    if (!file) return [];
    const user = isObj(v.user) ? str(v.user.name) : undefined;
    return [unknownResult(from, {
      id: str(v.id) ?? (file.link as string), kind: 'video', title: untitled('video'), author: user ?? 'Unknown',
      pageUrl: str(v.url) ?? (file.link as string), thumbnail: str(v.image) ?? '', downloadUrl: file.link as string, mime: 'video/mp4',
      width: num(file.width), height: num(file.height), durationMs: num(v.duration) !== undefined ? num(v.duration)! * 1000 : undefined,
    })];
  });
  return [...photos, ...videos];
}

// ---- Pixabay-style (hits[] with largeImageURL, or videos.{large,medium,small}) ----
export function parsePixabayStyle(body: unknown, from: From, licence: 'pixabay' | 'unknown' = 'unknown'): MediaResult[] | undefined {
  if (!isObj(body) || !Array.isArray(body.hits) || !('totalHits' in body || 'total' in body)) return undefined;
  return body.hits.filter(isObj).flatMap((h) => {
    const title = str(h.tags)?.split(',')[0]?.trim();
    const base = { id: str(h.id) ?? '', author: str(h.user) ?? 'Unknown', pageUrl: str(h.pageURL) ?? '' };
    let r: Omit<MediaResult, 'source' | 'sourceName' | 'licence' | 'licenceLabel'> | undefined;
    if (isObj(h.videos)) {
      const vs = h.videos;
      const file = [vs.large, vs.medium, vs.small, vs.tiny].find((f): f is Obj => isObj(f) && isUrl(f.url) && Math.max(num(f.width) ?? 0, num(f.height) ?? 0) <= 1920 && (num(f.width) ?? 0) > 0);
      if (!file) return [];
      r = { ...base, kind: 'video', title: title ?? untitled('video'), thumbnail: str(file.thumbnail) ?? '', downloadUrl: file.url as string, mime: 'video/mp4', width: num(file.width), height: num(file.height), durationMs: num(h.duration) !== undefined ? num(h.duration)! * 1000 : undefined };
    } else {
      const url = [h.largeImageURL, h.webformatURL].find(isUrl);
      if (!url) return [];
      r = { ...base, kind: 'image', title: title ?? untitled('image'), thumbnail: [h.webformatURL, h.previewURL].find(isUrl) ?? url, downloadUrl: url, mime: mimeOfUrl(url), width: num(h.imageWidth), height: num(h.imageHeight) };
    }
    if (!r.pageUrl) r.pageUrl = r.downloadUrl;
    if (!r.id) r.id = r.downloadUrl;
    if (licence === 'unknown') return [unknownResult(from, r)];
    return [{ ...r, source: from.source, licence, licenceLabel: licenceName(licence), licenceUrl: 'https://pixabay.com/service/license-summary/' }];
  });
}

// ---- Generic JSON: the first array of objects that hold an image, video or audio address ----
const MEDIA_KEYS = ['download_url', 'downloadUrl', 'source_url', 'file_url', 'fileUrl', 'image_url', 'imageUrl', 'audio_url', 'audioUrl', 'video_url', 'videoUrl', 'url', 'src', 'file', 'image', 'audio', 'video', 'download', 'original', 'full', 'large', 'regular'];
const THUMB_KEYS = ['thumbnail', 'thumbnail_url', 'thumb', 'preview', 'preview_url', 'previewUrl', 'small', 'medium'];
const TITLE_KEYS = ['title', 'name', 'caption', 'alt', 'alt_description', 'description'];
const AUTHOR_KEYS = ['author', 'creator', 'artist', 'artist_name', 'photographer', 'user', 'username', 'owner', 'credit'];
const LICENCE_KEYS = ['license', 'licence', 'license_url', 'licenseUrl', 'license_name', 'rights'];
const PAGE_KEYS = ['link', 'page', 'pageUrl', 'page_url', 'permalink', 'html_url', 'foreign_landing_url', 'shareurl', 'web_url'];

/** A media address inside a field: a URL string, or an object one level down holding one. */
function mediaIn(v: unknown, depth = 0): string | undefined {
  if (isUrl(v)) return v;
  if (isObj(v) && depth < 2) for (const k of MEDIA_KEYS) { const u = mediaIn(v[k], depth + 1); if (u) return u; }
  return undefined;
}
const textIn = (v: unknown): string | undefined => (isObj(v) ? str(v.rendered) ?? str(v.name) ?? str(v.value) ?? str(v.username) : plain(str(v)));

function genericItem(o: Obj, from: From, i: number): MediaResult | undefined {
  let url: string | undefined;
  let kind: MediaKind | undefined;
  const mimeField = str(o.mime_type) ?? str(o.mimeType) ?? str(o.mime) ?? str(o.content_type);
  for (const k of MEDIA_KEYS) {
    const u = mediaIn(o[k]);
    if (!u) continue;
    const kk = kindOfUrl(u) ?? kindOfMime(mimeField) ?? (/audio/i.test(k) ? 'audio' : /video/i.test(k) ? 'video' : /image|photo/i.test(k) ? 'image' : undefined);
    if (kk) { url = u; kind = kk; break; }
  }
  if (!url || !kind) return undefined;
  const thumb = THUMB_KEYS.map((k) => mediaIn(o[k])).find((u) => u && kindOfUrl(u) !== 'video' && kindOfUrl(u) !== 'audio');
  const title = TITLE_KEYS.map((k) => textIn(o[k])).find(Boolean);
  const author = AUTHOR_KEYS.map((k) => textIn(o[k])).find(Boolean);
  const licText = LICENCE_KEYS.map((k) => (isObj(o[k]) ? str((o[k] as Obj).url) ?? str((o[k] as Obj).name) : str(o[k]))).find(Boolean);
  const lic = licenceOf(licText, from);
  if (!lic) return undefined;
  const page = PAGE_KEYS.map((k) => o[k]).find(isUrl);
  return {
    id: str(o.id) ?? `${i}-${url}`, source: from.source, ...(from.sourceName ? { sourceName: from.sourceName } : {}), kind,
    title: title ?? untitled(kind), author: author ?? 'Unknown', licence: lic.licence, licenceLabel: lic.label,
    ...(lic.licence !== 'unknown' && isUrl(licText) ? { licenceUrl: licText } : {}),
    pageUrl: page ?? url, thumbnail: thumb ?? (kind === 'image' ? url : ''), downloadUrl: url, mime: mimeField && kindOfMime(mimeField) ? mimeField : mimeOfUrl(url),
    width: num(o.width), height: num(o.height),
  };
}

/** Breadth-first: the first array whose objects hold media addresses. */
function parseGeneric(body: unknown, from: From): MediaResult[] | undefined {
  const queue: [unknown, number][] = [[body, 0]];
  while (queue.length) {
    const [v, depth] = queue.shift()!;
    if (Array.isArray(v)) {
      const objs = v.filter(isObj);
      const items = objs.flatMap((o, i) => genericItem(o, from, i) ?? []);
      if (items.length) return items;
      if (depth < 4) for (const o of objs.slice(0, 3)) queue.push([o, depth + 1]);
    } else if (isObj(v) && depth < 4) for (const x of Object.values(v)) if (typeof x === 'object' && x) queue.push([x, depth + 1]);
  }
  return undefined;
}

export const FORMATS: readonly CustomFormat[] = ['openverse', 'wordpress', 'mediawiki', 'pexels', 'pixabay', 'generic'];
const PARSERS: Record<CustomFormat, (body: unknown, from: From) => MediaResult[] | undefined> = {
  openverse: parseOpenverse, wordpress: parseWordPress, mediawiki: parseMediaWiki, pexels: parsePexelsStyle, pixabay: (b, f) => parsePixabayStyle(b, f), generic: parseGeneric,
};

/** {format} in "Read as {format}." */
export const FORMAT_NAME: Record<CustomFormat, string> = {
  openverse: 'the Openverse API', wordpress: 'a WordPress media library', mediawiki: 'a Wikimedia or MediaWiki site', pexels: 'a Pexels-style API', pixabay: 'a Pixabay-style API', generic: 'a list of media links',
};

/** True when the reply is a known list shape that is simply empty. */
function emptyList(body: unknown): boolean {
  if (Array.isArray(body)) return body.length === 0;
  if (!isObj(body)) return false;
  if (isObj(body.query) && !('pages' in body.query)) return true;
  return ['results', 'hits', 'photos', 'videos', 'items', 'data', 'records'].some((k) => Array.isArray(body[k]) && (body[k] as unknown[]).length === 0);
}

export type ReadResult = { kind: 'ok'; format: CustomFormat; results: MediaResult[] } | { kind: 'empty'; format?: CustomFormat } | { kind: 'unreadable' };

/** Tries the formats in order. With `format`, reads only that one (a source added before keeps the format its test found). */
export function readResults(body: unknown, from: From, format?: CustomFormat): ReadResult {
  for (const f of format ? [format] : FORMATS) {
    const results = PARSERS[f](body, from);
    if (results === undefined) continue;
    if (results.length) return { kind: 'ok', format: f, results: results.map((r) => ({ ...r, downloadUrl: https(r.downloadUrl), thumbnail: r.thumbnail && https(r.thumbnail) })) };
    return { kind: 'empty', format: f };
  }
  return emptyList(body) ? { kind: 'empty' } : { kind: 'unreadable' };
}
