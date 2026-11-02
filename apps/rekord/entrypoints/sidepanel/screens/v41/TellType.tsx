import type { ReactNode } from 'react';
import { KeyboardIcon, MicIcon, Prompts } from './tellParts';
import type { PromptRow } from './tell';

/** V41TellType: the same prompts over typed text. "Talk instead" keeps what was typed; Done goes on to the questions. */
export function TellType({ title, rows, covered, text, onText, onTalk, onDone, canDone, banners }: {
  title: string; rows: PromptRow[]; covered: number; text: string; onText: (text: string) => void;
  onTalk: () => void; onDone: () => void; canDone: boolean; banners?: ReactNode;
}) {
  return (
    <>
      <div className="ct-barwrap">
        <div className="ct-bar ct-bar-typing">
          <span className="ct-kbd"><KeyboardIcon size={16} /></span>
          <div className="ct-bar-text"><span className="ct-bar-title">{title}</span><span className="ct-bar-sub">Catching up · typing</span></div>
          <button type="button" className="ct-bar-stop" aria-disabled={!canDone || undefined} onClick={() => canDone && onDone()}>Done</button>
        </div>
      </div>
      <div className="ct-row">
        <span className="ct-row-label">Type, or paste notes from a chat.</span>
        <button type="button" className="ct-switch" onClick={onTalk}><MicIcon size={15} />Talk instead</button>
      </div>
      {banners}
      <Prompts rows={rows} covered={covered} typing />
      <div className="ct-type">
        <label htmlFor="told">What happened?</label>
        <textarea id="told" value={text} onChange={(e) => onText(e.target.value)} autoFocus />
      </div>
      <p className="ct-foot">Say who promised what, and by when.</p>
    </>
  );
}
