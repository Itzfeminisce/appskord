import { captureProblem, type CaptureResult } from './result';

export interface PageImage {
  base64: string;
  mime: string;
  bytes: number;
  /** How the bytes were got: the page's own fetch (original file) or a redraw on a canvas (PNG). */
  via: 'fetch' | 'canvas';
}

type InPage = { ok: true; value: PageImage } | { ok: false; message: string };

// Runs inside the page, with the page's cookies and cache; must not use anything from this module's scope.
async function copyInPage(src: string): Promise<InPage> {
  const toBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
    return btoa(binary);
  };
  let fetchError = '';
  try {
    const response = await fetch(src, { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    return { ok: true, value: { base64: toBase64(await blob.arrayBuffer()), mime: blob.type || 'application/octet-stream', bytes: blob.size, via: 'fetch' } };
  } catch (error) {
    fetchError = error instanceof Error ? error.message : String(error);
  }
  // Cross-origin images the page may not fetch can still be drawn if they were served with CORS.
  const img = [...document.images].find((i) => i.currentSrc === src || i.src === src);
  if (!img || !img.naturalWidth) return { ok: false, message: `Could not fetch the image (${fetchError}) and it is not on the page.` };
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')!.drawImage(img, 0, 0);
    const base64 = canvas.toDataURL('image/png').split(',')[1] ?? '';
    return { ok: true, value: { base64, mime: 'image/png', bytes: Math.floor((base64.length * 3) / 4), via: 'canvas' } };
  } catch (error) {
    return { ok: false, message: `Could not fetch the image (${fetchError}) or copy it from the page (${error instanceof Error ? error.message : String(error)}).` };
  }
}

/** Copies the bytes of image `src` from inside tab `tabId`. Needs activeTab (or a host grant) on it. */
export async function pageImage(tabId: number, src: string): Promise<CaptureResult<PageImage>> {
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: copyInPage, args: [src] });
    const value = result?.result;
    if (!value) return { ok: false, problem: 'failed', message: 'The page returned nothing.' };
    return value.ok ? value : { ok: false, problem: 'failed', message: value.message };
  } catch (error) {
    return captureProblem(error);
  }
}

/** The copied image as a Blob, ready for lib/store/files. */
export function pageImageBlob(image: PageImage): Blob {
  const binary = atob(image.base64);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
  return new Blob([bytes], { type: image.mime });
}
