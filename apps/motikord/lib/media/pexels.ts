import { licenceName } from './licence';
import { MediaSearchError, type FetchLike, type MediaResult } from './openverse';

const PER_PAGE = 24;

interface PxPhoto { id: number; width: number; height: number; url: string; photographer: string; alt?: string; src: { original: string; large2x?: string; medium: string } }
interface PxVideo {
  id: number; width: number; height: number; url: string; duration: number; image: string; user: { name: string };
  video_files: { quality?: string; file_type: string; width: number; height: number; link: string }[];
}

export function mapPexelsPhoto(p: PxPhoto): MediaResult {
  return {
    id: String(p.id), source: 'pexels', kind: 'image', title: p.alt?.trim() || 'Pexels photo', author: p.photographer || 'Unknown',
    licence: 'pexels', licenceLabel: licenceName('pexels'), licenceUrl: 'https://www.pexels.com/license/', pageUrl: p.url,
    thumbnail: p.src.medium, downloadUrl: p.src.large2x ?? p.src.original, mime: 'image/jpeg', width: p.width, height: p.height,
  };
}

/** Picks the largest mp4 that is 1080 wide or less; undefined when the video has none. */
export function mapPexelsVideo(v: PxVideo): MediaResult | undefined {
  const mp4 = v.video_files.filter((f) => f.file_type === 'video/mp4').sort((a, b) => b.width - a.width);
  const file = mp4.find((f) => Math.max(f.width, f.height) <= 1920) ?? mp4[mp4.length - 1];
  if (!file) return undefined;
  return {
    id: String(v.id), source: 'pexels', kind: 'video', title: `Video by ${v.user.name}`, author: v.user.name || 'Unknown',
    licence: 'pexels', licenceLabel: licenceName('pexels'), licenceUrl: 'https://www.pexels.com/license/', pageUrl: v.url,
    thumbnail: v.image, downloadUrl: file.link, mime: 'video/mp4', width: file.width, height: file.height, durationMs: Math.round(v.duration * 1000),
  };
}

/** The key goes in the Authorization header and nowhere else; never logged. */
export async function searchPexels(fetchFn: FetchLike, key: string, q: string, kind: 'image' | 'video'): Promise<MediaResult[]> {
  const url = kind === 'image'
    ? `https://api.pexels.com/v1/search?${new URLSearchParams({ query: q, per_page: String(PER_PAGE) })}`
    : `https://api.pexels.com/videos/search?${new URLSearchParams({ query: q, per_page: String(PER_PAGE) })}`;
  let res: Response;
  try {
    res = await fetchFn(url, { headers: { Authorization: key }, credentials: 'omit' });
  } catch {
    throw new MediaSearchError('offline', 'Could not reach Pexels.');
  }
  if (res.status === 401 || res.status === 403) throw new MediaSearchError('key', 'Pexels did not accept the key.');
  if (!res.ok) throw new MediaSearchError('failed', `Pexels answered ${res.status}.`, res.status);
  const body = (await res.json()) as { photos?: PxPhoto[]; videos?: PxVideo[] };
  return kind === 'image' ? (body.photos ?? []).map(mapPexelsPhoto) : (body.videos ?? []).flatMap((v) => mapPexelsVideo(v) ?? []);
}
