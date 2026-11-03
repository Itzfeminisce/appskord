/** What a drop on the board does: files to add, files skipped (and why), or a .briefkord board file to import. */
import { refuseFile, type FileRefusal } from '@/lib/store/files';

export interface DroppedFile { name: string; type: string; size: number }

export interface DropPlan<F extends DroppedFile> {
  accepted: F[];
  skipped: { file: F; reason: FileRefusal }[];
  /** A board file opens as a new board (Import) instead of being added. */
  boardFile?: F;
}

export const isBoardFile = (file: { name: string }): boolean => /\.briefkord$/i.test(file.name);

export function planDrop<F extends DroppedFile>(files: readonly F[]): DropPlan<F> {
  const boardFile = files.find(isBoardFile);
  if (boardFile) return { accepted: [], skipped: [], boardFile };
  const accepted: F[] = [];
  const skipped: { file: F; reason: FileRefusal }[] = [];
  for (const file of files) {
    const reason = refuseFile(file);
    if (reason) skipped.push({ file, reason });
    else accepted.push(file);
  }
  return { accepted, skipped };
}

/** Bytes as the frames write them: "2.4 MB", "412 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${trim(bytes / 1e9)} GB`;
  if (bytes >= 1e6) return `${trim(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}

const trim = (n: number): string => (n >= 100 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, ''));
