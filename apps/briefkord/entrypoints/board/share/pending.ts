/** A .briefkord file dropped on a board, handed to the Import screen. */
let pending: File | undefined;

export function setPendingImport(file: File): void {
  pending = file;
}

/** The handed-over file, once. */
export function takePendingImport(): File | undefined {
  const file = pending;
  pending = undefined;
  return file;
}
