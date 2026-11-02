import { useState } from 'react';
import type { RecallCard as Card } from '@/lib/live/recall';
import { DotsIcon, RecallIcon } from './liveIcons';

/** The transcript at a moment (TranscriptCited), in a new tab so the live view stays. */
export function citedUrl(meetingId: string, atMs: number): string {
  const page = (browser.runtime.getURL as (p: string) => string)('/sidepanel.html');
  return `${page}#/transcript?meeting=${encodeURIComponent(meetingId)}&at=${Math.max(0, Math.round(atMs))}`;
}

/** V4Live: "You talked about this before", slid in above the footer. */
export function RecallCard({ card, onNotNow, onMute }: { card: Card; onNotNow: () => void; onMute: () => void }) {
  const [menu, setMenu] = useState(false);
  return (
    <section aria-label="Recall" className="lv-recall">
      <div className="lv-recall-head">
        <RecallIcon />
        <span className="lv-recall-title">You talked about this before</span>
        <button type="button" className="lv-more" aria-label="More: Mute recall for this meeting" title="Mute recall for this meeting" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <DotsIcon />
        </button>
      </div>
      {menu && (
        <div className="lv-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setMenu(false); onMute(); }}>Mute recall for this meeting</button>
        </div>
      )}
      <p>{card.text}</p>
      <div className="lv-row">
        <a className="lv-btn-dark" href={citedUrl(card.meetingId, card.atMs)} target="_blank" rel="noopener" style={{ textDecoration: 'none' }}>Open</a>
        <button type="button" className="lv-btn-soft" onClick={onNotNow}>Not now</button>
      </div>
    </section>
  );
}
