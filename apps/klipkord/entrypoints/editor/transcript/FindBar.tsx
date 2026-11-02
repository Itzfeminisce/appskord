import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import type { Cut, Project } from '@/lib/project/types';
import type { Unit } from '@/lib/wordCuts';
import { C, Icon, iconButton, MONO } from '../ui';
import { ICON } from './icons';
import { cutMatches, findMatches, replaceAll, replaceOne, zoomRanges, type Match } from './model';

const FIELD: CSSProperties = {
  flexGrow: 1, minWidth: 0, height: 30, borderRadius: 7, border: `1px solid ${C.line}`, background: C.ground, color: C.text, padding: '0 8px',
  fontFamily: 'inherit', fontSize: 13, boxSizing: 'border-box',
};
const BUTTON: CSSProperties = {
  height: 30, padding: '0 12px', borderRadius: 8, background: C.raised, color: C.text, border: `1px solid ${C.line}`, fontFamily: 'inherit', fontSize: 13,
  fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap', boxSizing: 'border-box',
};
const QUIET: CSSProperties = { ...BUTTON, height: 26, background: 'transparent', color: C.secondary, border: 0 };

export interface FindBarProps {
  units: Unit[]; project: Project; cut: Cut; readOnly: boolean;
  edit(op: (p: Project) => Project): void;
  onMatches(list: Match[], current: number): void;
  onClose(): void;
}

/** TranscriptSearch: find, replace through word fixes, cut or zoom on every match. */
export function FindBar({ units, project, cut, readOnly, edit, onMatches, onClose }: FindBarProps) {
  const [query, setQuery] = useState('');
  const [fresh, setFresh] = useState('');
  const [current, setCurrent] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => findMatches(units, project.wordFixes, cut, query), [units, project.wordFixes, cut, query]);
  const at = matches.length ? Math.min(current, matches.length - 1) : -1;

  useEffect(() => { input.current?.focus(); }, []);
  const report = useRef(onMatches);
  report.current = onMatches;
  useEffect(() => { report.current(matches, at); }, [matches, at]);

  const next = () => setCurrent(matches.length ? (at + 1) % matches.length : 0);
  const n = matches.length;
  const fixable = n > 0 && fresh.trim() !== '' && !readOnly;
  const onKey = (e: KeyboardEvent, enter: () => void) => {
    if (e.key === 'Enter') { e.preventDefault(); enter(); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, margin: '0 8px 6px', borderRadius: 10, background: C.raised, border: `1px solid ${C.line}`, flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input ref={input} aria-label="Find" value={query} onChange={(e) => { setQuery(e.target.value); setCurrent(0); }} onKeyDown={(e) => onKey(e, next)}
          style={{ ...FIELD, border: `1px solid ${C.accentText}`, outline: 'none' }} />
        <span style={{ fontFamily: MONO, fontSize: 11, color: C.secondary, padding: '0 4px', whiteSpace: 'nowrap' }}>{query ? `${at + 1} of ${n}` : ''}</span>
        <button type="button" aria-label="Next (Enter)" title="Next (Enter)" onClick={next} style={iconButton(28)}><Icon>{ICON.next}</Icon></button>
        <button type="button" aria-label="Close (Esc)" title="Close (Esc)" onClick={onClose} style={iconButton(28)}><Icon>{ICON.close}</Icon></button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input aria-label="Replace with" value={fresh} onChange={(e) => setFresh(e.target.value)} style={FIELD}
          onKeyDown={(e) => onKey(e, () => { const m = matches[at]; if (m && fixable) edit((p) => replaceOne(p, units, m, fresh)); })} />
        <button type="button" disabled={!fixable} onClick={() => edit((p) => replaceAll(p, units, matches, query, fresh))} style={BUTTON}><span>Replace all</span></button>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" disabled={!n || readOnly} onClick={() => edit((p) => cutMatches(p, units, matches))} style={QUIET}>
          <Icon size={15}>{ICON.cut}</Icon><span>{`Cut all ${n}`}</span>
        </button>
        <button type="button" disabled={!n || readOnly} onClick={() => edit((p) => zoomRanges(p, units, matches))} style={QUIET}>
          <Icon size={15}>{ICON.zoom}</Icon><span>{`Zoom on all ${n}`}</span>
        </button>
      </div>
    </div>
  );
}
