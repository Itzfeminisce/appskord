import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Cut, Project } from '@/lib/project/types';
import { wordCount, type Unit } from '@/lib/wordCuts';
import { clock } from '../format';
import { Icon, MONO } from '../ui';
import { ICON } from './icons';
import { chapterAt, cutFromRange, deleteRange, indexes, outSpan, speedRange, SPEEDS, zoomRanges, type Range } from './model';

const INK = '#0E0E11';
const BUTTON: CSSProperties = {
  height: 28, padding: '0 8px', border: 0, borderRadius: 7, background: 'transparent', color: INK, fontFamily: 'inherit', fontSize: 12.5,
  fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', whiteSpace: 'nowrap',
};
const MENU: CSSProperties = {
  position: 'absolute', top: 'calc(100% + 4px)', zIndex: 7, display: 'flex', flexDirection: 'column', padding: 4, borderRadius: 10,
  background: '#F4F4F5', color: INK, boxShadow: '0 12px 30px rgba(0,0,0,0.45)', minWidth: 120,
};

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

function Action({ title, icon, label, onClick }: { title: string; icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" title={title} onClick={onClick} style={BUTTON}><Icon size={14} color={INK}>{icon}</Icon>{label}</button>;
}

export interface SelectBarProps {
  units: Unit[]; range: Range; text: string; cut: Cut;
  edit(op: (p: Project) => Project): void;
  onDone(): void;
}

/** TextSelect: what the selected words can become. Each action is one op and one Undo step. */
export function SelectBar({ units, range, text, cut, edit, onDone }: SelectBarProps) {
  const [menu, setMenu] = useState<'speed' | 'more' | null>(null);
  const n = wordCount(units, indexes(range));
  const { from, to } = outSpan(cut, units, range);
  const run = (op: (p: Project) => Project) => { edit(op); onDone(); };
  const del = () => run((p) => deleteRange(p, units, range));
  const zoom = () => run((p) => zoomRanges(p, units, [range]));
  const chapter = () => run((p) => chapterAt(p, units, range));

  const keys = useRef({ del, zoom, chapter, speed: () => setMenu('speed') });
  keys.current = { del, zoom, chapter, speed: () => setMenu('speed') };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = keys.current;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); k.del(); }
      else if (e.key === 'r' || e.key === 'R') k.speed();
      else if (e.key === 'z' || e.key === 'Z') k.zoom();
      else if (e.key === 'm' || e.key === 'M') k.chapter();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const copy = () => {
    navigator.clipboard?.writeText(text).catch((error: unknown) => console.error('Klipkord: could not copy the text', error));
    onDone();
  };

  return (
    <div role="toolbar" aria-label="Selected words" onMouseDown={(e) => e.stopPropagation()} style={{
      position: 'absolute', left: 16, top: 'calc(100% + 2px)', zIndex: 6, display: 'flex', alignItems: 'center', gap: 2, padding: 4,
      borderRadius: 10, background: '#F4F4F5', color: INK, boxShadow: '0 12px 30px rgba(0,0,0,0.45)',
    }}>
      <span style={{ fontSize: 12, fontWeight: 600, padding: '0 8px', fontFamily: MONO, whiteSpace: 'nowrap' }}>
        {`${n} ${n === 1 ? 'word' : 'words'} · ${clock(from)} to ${clock(to)}`}
      </span>
      <Action title="Delete (Del)" icon={ICON.trash} label="Delete" onClick={del} />
      <span style={{ position: 'relative' }}>
        <Action title="Speed up (R)" icon={ICON.speed} label="Speed" onClick={() => setMenu(menu === 'speed' ? null : 'speed')} />
        {menu === 'speed' && (
          <div role="menu" aria-label="Speed" style={{ ...MENU, left: 0, flexDirection: 'row', minWidth: 0 }}>
            {SPEEDS.map((s) => (
              <button key={s} type="button" role="menuitem" onClick={() => run((p) => speedRange(p, units, range, s))} style={BUTTON}>{`${s}x`}</button>
            ))}
          </div>
        )}
      </span>
      <Action title="Zoom on this part (Z)" icon={ICON.zoom} label="Zoom" onClick={zoom} />
      <Action title="Start a chapter here (M)" icon={ICON.flag} label="Chapter" onClick={chapter} />
      <span style={{ position: 'relative' }}>
        <Action title="Make a cut from this, copy text" icon={ICON.more} label="More" onClick={() => setMenu(menu === 'more' ? null : 'more')} />
        {menu === 'more' && (
          <div role="menu" aria-label="More" style={{ ...MENU, right: 0 }}>
            <button type="button" role="menuitem" onClick={() => run((p) => cutFromRange(p, units, range))} style={BUTTON}>Make a cut from this</button>
            <button type="button" role="menuitem" onClick={copy} style={BUTTON}>Copy text</button>
          </div>
        )}
      </span>
    </div>
  );
}
