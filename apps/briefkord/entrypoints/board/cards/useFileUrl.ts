/** Object URLs for card files in OPFS, kept for the board on screen and revoked when the tab moves to another board. */
import { useEffect, useState } from 'react';
import type { FileRef } from '@/lib/board/types';
import { readFile } from '@/lib/store/files';

let cacheBoard: string | undefined;
const cache = new Map<string, Promise<string | undefined>>();

const revoke = (url: Promise<string | undefined>) => void url.then((u) => u && URL.revokeObjectURL(u));

export function fileUrl(boardId: string, ref: FileRef): Promise<string | undefined> {
  if (boardId !== cacheBoard) {
    cache.forEach(revoke);
    cache.clear();
    cacheBoard = boardId;
  }
  let url = cache.get(ref.id);
  if (!url) {
    url = readFile(boardId, ref)
      .then((blob) => (blob ? URL.createObjectURL(blob) : undefined))
      .catch((error: unknown) => {
        console.error('Briefkord: could not read a card file', error);
        cache.delete(ref.id);
        return undefined;
      });
    cache.set(ref.id, url);
  }
  return url;
}

export function useFileUrl(boardId: string, ref: FileRef | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  const fileId = ref?.id;
  useEffect(() => {
    let alive = true;
    setUrl(undefined);
    if (ref) void fileUrl(boardId, ref).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
    // The bytes behind a file id never change, so the id is enough.
  }, [boardId, fileId]);
  return url;
}
