/** Object URLs for card files in OPFS, made once per file for the life of the tab. */
import { useEffect, useState } from 'react';
import { readFile } from '@/lib/store/files';

const cache = new Map<string, Promise<string | undefined>>();

export function fileUrl(boardId: string, fileId: string): Promise<string | undefined> {
  const key = `${boardId}/${fileId}`;
  let url = cache.get(key);
  if (!url) {
    url = readFile(boardId, fileId)
      .then((file) => (file ? URL.createObjectURL(file) : undefined))
      .catch((error: unknown) => {
        console.error('Briefkord: could not read a card file', error);
        cache.delete(key);
        return undefined;
      });
    cache.set(key, url);
  }
  return url;
}

export function useFileUrl(boardId: string, fileId: string | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    setUrl(undefined);
    if (fileId) void fileUrl(boardId, fileId).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [boardId, fileId]);
  return url;
}
