/** ShortcutsHelp: the board's "?" or the ? key. */
import { Fragment, type ReactNode } from 'react';
import { Close } from '../icons';

const keys = (...k: string[]): ReactNode => k.map((x, i) => <Fragment key={i}>{i > 0 && ' '}<kbd>{x}</kbd></Fragment>);

const TOOLS: [string, ReactNode][] = [
  ['Select', keys('V')], ['Note', keys('N')], ['Checklist', keys('C')], ['Diagram', keys('D')], ['Arrow', keys('A')], ['Group', keys('G')], ['Search the board', keys('Ctrl', 'K')],
];
const CARDS: [string, ReactNode][] = [
  ['Open large', keys('Space')], ['Duplicate', keys('Ctrl', 'D')], ['Delete', keys('Del')], ['Move up or down the list', keys('Alt', '↑', '↓')],
  ['Undo', keys('Ctrl', 'Z')], ['Redo', keys('Ctrl', 'Shift', 'Z')], ['Pan the canvas', <>{keys('Space')} + drag</>],
];
const MEETING: [string, ReactNode][] = [
  ['Next card', keys('→')], ['Previous card', keys('←')], ['Show or hide notes', keys('N')], ['Full screen', keys('F')], ['Leave meeting mode', keys('Esc')],
];

function Column({ title, rows, children, last }: { title: string; rows: [string, ReactNode][]; children?: ReactNode; last?: boolean }) {
  return (
    <section className={last ? 'bk-keys-col is-last' : 'bk-keys-col'}>
      <h3>{title}</h3>
      {rows.map(([label, k]) => (
        <span key={label} className="bk-keys-row">{label}<span className="bk-keys">{k}</span></span>
      ))}
      {children}
    </section>
  );
}

export function ShortcutsHelp({ onClose }: { onClose(): void }) {
  return (
    <div className="bk-scrim bk-scrim-light" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="sh-title" className="bk-help">
        <header>
          <h2 id="sh-title">Keyboard shortcuts</h2>
          <span className="bk-help-press">Press <kbd>?</kbd> any time</span>
          <button type="button" className="bk-icon-btn bk-icon-sm" aria-label="Close (Esc)" onClick={onClose}><Close /></button>
        </header>
        <div className="bk-keys-grid">
          <Column title="Tools" rows={TOOLS} />
          <Column title="Cards" rows={CARDS} />
          <Column title="Meeting mode" rows={MEETING} last>
            <span className="bk-keys-note">On a Mac, Ctrl is ⌘ and Alt is ⌥.</span>
          </Column>
        </div>
      </div>
    </div>
  );
}
