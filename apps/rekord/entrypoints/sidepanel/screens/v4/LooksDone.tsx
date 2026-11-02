import { tabOf } from '@/lib/memory/rank';
import type { MemoryItem } from '@/lib/memory/types';
import { LoopsHome, toastOnHome } from './Home';
import { apply, FromTo, useSheetItem } from './Promise';
import { BigCheck, CloseButton, KindTag, QuoteBlock, Sheet, useCloseSheet, useMemoryView, type MemoryView } from './parts';

/** "Looks done?": the promise and what Rekord heard. Nothing is closed without the user's click. */
function LooksDoneSheet({ item, view }: { item: MemoryItem; view: MemoryView }) {
  const close = useCloseSheet();
  const yes = async () => {
    if (await apply(item, { type: 'done' })) toastOnHome(`Marked “${item.text}” as done`, item);
    close();
  };
  const notYet = async () => {
    await apply(item, { type: 'notYet' });
    close();
  };
  return (
    <Sheet label="Looks done?" onClose={close} roomy>
      <div className="lp-sheet-head">
        <div className="lp-sheet-title lp-sheet-title-tight">
          <h1 className="lp-h1-big">Looks done?</h1>
          <span className="lp-sheet-sub">Rekord heard something that sounds like this is finished.</span>
        </div>
        <CloseButton onClose={close} />
      </div>
      <div className="lp-card">
        <KindTag kind={item.kind} />
        <span className="lp-card-title">{item.text}</span>
        <span className="lp-card-who"><FromTo item={item} view={view} size={24} /></span>
      </div>
      {item.evidence && (
        <div className="lp-heard">
          <span className="lp-label">What Rekord heard</span>
          <QuoteBlock quote={item.evidence} meetings={view.meetings} accent="#1A6B40" />
        </div>
      )}
      <div className="lp-actions">
        <button type="button" className="lp-primary" onClick={() => void yes()}><BigCheck />Yes, it’s done</button>
        <button type="button" className="lp-secondary" onClick={() => void notYet()}>Not yet</button>
      </div>
      <p className="lp-note">Nothing is closed without you.</p>
    </Sheet>
  );
}

export default function LooksDoneScreen() {
  const [item] = useSheetItem();
  const [view] = useMemoryView();
  return (
    <LoopsHome tab={item ? tabOf(item) : undefined} sheet>
      {item && view.ready && <LooksDoneSheet item={item} view={view} />}
    </LoopsHome>
  );
}
