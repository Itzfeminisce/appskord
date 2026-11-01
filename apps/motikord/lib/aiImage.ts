import { mediaPath, putMedia } from './media';
import { getKey } from './settings';
import type { Asset, Aspect } from './types';
import type { FetchLike } from './media/openverse';

export const IMAGE_WORD_LIMIT = 12;
export const IMAGE_CREDIT = 'AI image, OpenAI';
const ENDPOINT = 'https://api.openai.com/v1/images/generations';
const SIZES: Record<Aspect, { size: string; width: number; height: number }> = {
  '9:16': { size: '1024x1536', width: 1024, height: 1536 },
  '1:1': { size: '1024x1024', width: 1024, height: 1024 },
  '16:9': { size: '1536x1024', width: 1536, height: 1024 },
};

/** The states a failed image shows (StatesLookV2). */
export type ImageFailure = 'image-key-missing' | 'image-key-rejected' | 'image-refused' | 'image-quota' | 'image-offline';

export class ImageError extends Error {
  constructor(readonly state: ImageFailure) { super(state); this.name = 'ImageError'; }
}

export const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;
export const limitWords = (text: string, max = IMAGE_WORD_LIMIT): string => text.trim().split(/\s+/).filter(Boolean).slice(0, max).join(' ');

/** Each error status maps to one state; a network failure or a server fault reads as offline. */
export function stateForStatus(status: number): ImageFailure {
  if (status === 401 || status === 403) return 'image-key-rejected';
  if (status === 429) return 'image-quota';
  if (status >= 500) return 'image-offline';
  return 'image-refused';
}

export interface ImageDeps { fetch: FetchLike; key?: string; signal?: AbortSignal }
export interface MadeImage { blob: Blob; width: number; height: number; description: string }

const fromBase64 = (b64: string): Blob => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
};

/** One request per image. Only the description (12 words or fewer) is sent; the key is never logged. */
export async function makeImage(description: string, aspect: Aspect, deps: ImageDeps): Promise<MadeImage> {
  const prompt = limitWords(description);
  if (!prompt) throw new ImageError('image-refused');
  const key = deps.key ?? (await getKey('openai'));
  if (!key) throw new ImageError('image-key-missing');
  const { size, width, height } = SIZES[aspect];
  let res: Response;
  try {
    res = await deps.fetch(ENDPOINT, {
      method: 'POST', credentials: 'omit', signal: deps.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, size, n: 1 }),
    });
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') throw error;
    throw new ImageError('image-offline');
  }
  if (!res.ok) throw new ImageError(stateForStatus(res.status));
  let b64: unknown;
  try {
    b64 = ((await res.json()) as { data?: { b64_json?: unknown }[] }).data?.[0]?.b64_json;
  } catch {
    throw new ImageError('image-refused');
  }
  if (typeof b64 !== 'string' || !b64) throw new ImageError('image-refused');
  return { blob: fromBase64(b64), width, height, description: prompt };
}

/** Keeps the image in OPFS as local media with the credit "AI image, OpenAI". */
export async function saveImage(img: MadeImage, deps: { put?: (path: string, data: Blob) => Promise<void>; id?: string } = {}): Promise<Asset> {
  const id = deps.id ?? crypto.randomUUID();
  const opfsPath = mediaPath(id, 'png');
  await (deps.put ?? putMedia)(opfsPath, img.blob);
  return {
    id, kind: 'image', name: img.description, mime: 'image/png', bytes: img.blob.size, width: img.width, height: img.height, opfsPath,
    credit: { title: img.description, author: 'OpenAI', source: 'ai', sourceName: 'OpenAI', licence: 'ai', url: '' },
  };
}
