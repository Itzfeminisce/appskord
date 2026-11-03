/** Frame PanelFirstRun names the first board; later boards use the AllBoards "New board" field copy. */
import { useState } from 'react';
import { saveCapture } from '@/lib/capture/save';
import { makeBoard, usePanel } from '../data';
import { BackIcon, LockIcon } from '../icons';
import { useGo } from '../ui';

function Art() {
  return (
    <>
      <span style={{ position: 'absolute', left: 34, top: 40, width: 132, height: 86, borderRadius: 12, background: 'var(--bk-card)', border: '1px solid var(--bk-line)', boxShadow: '0 8px 20px -10px rgba(17,17,20,0.25)', transform: 'rotate(-3deg)' }}>
        <span style={{ display: 'block', height: 44, borderRadius: '11px 11px 0 0', background: 'var(--p-gradient)' }} />
        <span style={{ display: 'block', margin: '10px 10px 0', height: 6, width: '70%', borderRadius: 3, background: 'var(--p-dash)' }} />
        <span style={{ display: 'block', margin: '6px 10px 0', height: 6, width: '45%', borderRadius: 3, background: 'var(--p-skeleton)' }} />
      </span>
      <span style={{ position: 'absolute', left: 196, top: 30, width: 150, height: 64, borderRadius: 12, background: 'var(--bk-yellow)', border: '1px solid var(--p-amber-line)', boxShadow: '0 8px 20px -10px rgba(17,17,20,0.2)', transform: 'rotate(2deg)' }}>
        <span style={{ display: 'block', margin: '14px 12px 0', height: 6, width: '80%', borderRadius: 3, background: 'var(--p-amber-mark)', opacity: 0.45 }} />
        <span style={{ display: 'block', margin: '7px 12px 0', height: 6, width: '56%', borderRadius: 3, background: 'var(--p-amber-mark)', opacity: 0.3 }} />
      </span>
      <span style={{ position: 'absolute', left: 214, top: 118, width: 132, height: 70, borderRadius: 12, background: 'var(--bk-card)', border: '1.5px solid var(--bk-accent)', boxShadow: '0 10px 24px -10px rgba(15,118,110,0.45)' }}>
        <span style={{ position: 'absolute', left: 14, top: 14, width: 30, height: 18, borderRadius: 5, border: '1.5px solid var(--bk-accent)' }} />
        <span style={{ position: 'absolute', left: 82, top: 14, width: 30, height: 18, borderRadius: 5, border: '1.5px solid var(--bk-accent)', background: 'var(--bk-tint)' }} />
        <span style={{ position: 'absolute', left: 46, top: 22, width: 34, height: 1.5, background: 'var(--bk-accent)' }} />
        <span style={{ position: 'absolute', left: 48, top: 44, width: 30, height: 14, borderRadius: 4, border: '1.5px solid var(--bk-accent)' }} />
      </span>
      <svg width="400" height="220" viewBox="0 0 400 220" fill="none" style={{ position: 'absolute', inset: 0 }}>
        <path d="M166 98 C 190 120, 196 140, 214 150" stroke="var(--bk-accent)" strokeWidth="1.5" strokeDasharray="4 4" />
      </svg>
    </>
  );
}

export function NewBoard() {
  const { boards, takeCapture, setNotice } = usePanel();
  const go = useGo();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [empty, setEmpty] = useState(false);
  const first = boards.length === 0;

  const make = async () => {
    if (busy) return;
    if (!name.trim()) return setEmpty(true);
    setBusy(true);
    try {
      const board = await makeBoard(name);
      const capture = takeCapture();
      if (capture) {
        const result = await saveCapture(capture, board.id);
        if (!result.ok && result.problem === 'image-blocked' && capture.kind === 'image')
          setNotice({ kind: 'image-blocked', boardId: board.id, tabId: capture.tabId, pageUrl: capture.pageUrl, pageTitle: capture.pageTitle });
        else if (!result.ok && result.problem === 'file-too-big') setNotice({ kind: 'file-too-big', name: result.name, bytes: result.bytes });
        else if (!result.ok && result.problem === 'storage-low') setNotice({ kind: 'storage-low' });
      }
      go('/');
    } catch (error) {
      console.error('Briefkord: could not make the board', error);
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="p-art">
        {boards.length > 0 && (
          <button type="button" className="p-icon-btn is-ink p-art-back" aria-label="Back" onClick={() => go('/boards')}>
            <BackIcon />
          </button>
        )}
        <div aria-hidden="true" style={{ position: 'absolute', inset: 0 }}>
          <Art />
        </div>
      </div>
      {first && (
        <div className="p-intro">
          <h1>One board for every meeting</h1>
          <p>Save pages, images and notes while you browse. Arrange them on a canvas or as an agenda, then walk through them in the meeting.</p>
        </div>
      )}
      <form
        style={{ display: 'contents' }}
        onSubmit={(event) => {
          event.preventDefault();
          void make();
        }}
      >
        <div className="p-first-field">
          <label htmlFor="first-board" className="p-label">
            {first ? 'Name your first board' : 'New board'}
          </label>
          <input
            id="first-board"
            type="text"
            autoFocus
            aria-invalid={empty || undefined}
            placeholder={first ? 'For example: Checkout redesign review' : 'Name it after the meeting'}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setEmpty(false);
            }}
          />
          {empty && (
            <span role="alert" className="p-field-error">
              Give the board a name.
            </span>
          )}
        </div>
        <button type="submit" className="p-btn is-primary p-make" disabled={busy}>
          Make the board
        </button>
      </form>
      <div className="p-privacy">
        <LockIcon stroke="var(--bk-accent)" />
        <p>Everything stays on this computer. No account, no server. A board leaves only in a file you export.</p>
      </div>
    </div>
  );
}
