import { Dialog, StateCard } from './StateCard';

export function OpenElsewhere({ onEditHere, onClose }: { onEditHere: () => void; onClose: () => void }) {
  return (
    <Dialog>
      <StateCard state="open-elsewhere" role="dialog" title="Open in another tab"
        body="This project is being edited in another tab. Edit here and that tab becomes read-only."
        actions={[{ label: 'Edit here', tone: 'primary', onClick: onEditHere }, { label: 'Close', tone: 'ghost', onClick: onClose }]} />
    </Dialog>
  );
}

/** unsaved-recovered: `minutes` since the kept edits were made. */
export function UnsavedRecovered({ changes, minutes, onKeep, onDiscard }: { changes: number; minutes: number; onKeep: () => void; onDiscard: () => void }) {
  return (
    <Dialog>
      <StateCard state="unsaved-recovered" role="dialog" title="Your last edits were kept"
        body={`Klipkord closed before saving. ${changes} changes from ${minutes} min ago are back.`}
        actions={[{ label: 'Keep them', tone: 'primary', onClick: onKeep }, { label: 'Discard', tone: 'ghost', onClick: onDiscard }]} />
    </Dialog>
  );
}
