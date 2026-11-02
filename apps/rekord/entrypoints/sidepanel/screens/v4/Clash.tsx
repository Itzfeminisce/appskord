import { shortDate } from '@/lib/askAll';
import type { Clash } from '@/lib/live/clash';
import { WarnIcon } from './liveIcons';

/** V4Clash: an amber card when a line may change an earlier decision. Only while clash alerts are on. */
export function ClashCard({ clash, decidedAt, busy, onYes, onNo, onTurnOff }: {
  clash: Clash; decidedAt: number; busy: boolean; onYes: () => void; onNo: () => void; onTurnOff: () => void;
}) {
  return (
    <>
      <div aria-hidden="true" className="lv-clash-veil" />
      <section aria-label="This may change an earlier decision" className="lv-clash">
        <div className="lv-clash-head">
          <WarnIcon />
          <h2>This may change an earlier decision</h2>
        </div>
        <div className="lv-clash-box">
          <div>Before ({shortDate(decidedAt)})</div>
          <div>{clash.decision.text}</div>
        </div>
        <div className="lv-clash-box">
          <div>Now</div>
          <div>{clash.speaker}: “{clash.segment.text.trim()}”</div>
        </div>
        <div className="lv-row">
          <button type="button" className="lv-clash-yes" disabled={busy} onClick={onYes}>Yes, it replaces it</button>
          <button type="button" className="lv-clash-no" disabled={busy} onClick={onNo}>No, not a change</button>
        </div>
        <button type="button" className="lv-clash-off" onClick={onTurnOff}>Turn clash alerts off</button>
      </section>
    </>
  );
}
