import { useCallback, useRef, useState } from 'react';
import { deleteCut, duplicateCut, FULL_CUT_NAME, newCut, renameCut, selectCut } from '@/lib/project/cuts';
import { quote } from '@/lib/project/ops';
import { cutLength } from '@/lib/project/time';
import type { Cut, Project } from '@/lib/project/types';
import type { SlotProps } from '../components/slots';
import { clock, minutesAgo } from '../format';
import { floating, TL_ICONS, useEscape, useOutside } from '../timeline/controls';
import { setTimeline } from '../timeline/store';
import { C, Icon } from '../ui';

/** "16:9 · 6:11 · edited 2 min ago", "1:1 · 0:30 · made by AI". */
export function cutMeta(project: Project, cut: Cut, now: number): string {
  const parts = [cut.shape, clock(cutLength(cut))];
  if (cut.made === 'ai' || cut.made === 'highlight') parts.push('made by AI');
  else {
    const last = project.history[cut.id]?.undo.at(-1)?.at;
    if (last) parts.push(`edited ${minutesAgo(last, now)} min ago`);
  }
  return parts.join(' · ');
}

const item = { height: 34, padding: '0 10px', border: 0, borderRadius: 8, background: 'transparent', color: C.text, fontFamily: 'inherit', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', textAlign: 'left' } as const;

/** Cuts: the menu under the cut switcher. Edits in one cut never change another. */
export function Cuts({ p, renaming, onClose, now = Date.now() }: { p: SlotProps; renaming: boolean; onClose: () => void; now?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEscape(onClose);
  useOutside(useCallback(() => ref.current, []), onClose);
  const current = p.cut;
  const [name, setName] = useState(current.name);
  const startRename = (from: string) => { setName(from); setTimeline({ renaming: true }); };
  const finish = () => {
    if (renaming) p.edit((project) => renameCut(project, { id: current.id, name }));
    setTimeline({ renaming: false });
  };
  const anchor = document.querySelector('[aria-label="Switch cut"]')?.getBoundingClientRect();
  return (
    <div ref={ref} role="menu" aria-label="Cuts" style={{ ...floating, position: 'fixed', left: anchor?.left ?? 196, top: 44, width: 320, padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11.5, fontWeight: 600, color: C.muted, padding: '6px 10px 2px' }}>Cuts of this recording</span>
      {p.project.cuts.map((c) => (
        <div key={c.id} role="menuitemradio" aria-checked={c.id === current.id} tabIndex={-1}
          onClick={() => { if (!(renaming && c.id === current.id)) { p.edit((project) => selectCut(project, { id: c.id })); onClose(); } }}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, color: C.text, background: c.id === current.id ? C.tabOn : 'transparent', cursor: 'pointer' }}>
          <span style={{ width: 48, height: 28, borderRadius: 4, background: 'linear-gradient(135deg, #7C2D12, #C2410C)', flexShrink: 0 }} />
          <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
            {renaming && c.id === current.id ? (
              // eslint-disable-next-line jsx-a11y/no-autofocus
              <input autoFocus aria-label="Rename" value={name} onChange={(e) => setName(e.target.value)} onBlur={finish} onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === 'Enter') finish(); if (e.key === 'Escape') { e.stopPropagation(); setTimeline({ renaming: false }); } }}
                style={{ height: 24, borderRadius: 6, border: `1px solid ${C.line}`, background: C.ground, color: C.text, padding: '0 6px', fontFamily: 'inherit', fontSize: 13 }} />
            ) : (
              <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
            )}
            <span style={{ fontSize: 11.5, color: C.muted }}>{cutMeta(p.project, c, now)}</span>
          </span>
          {c.id === current.id && <Icon>{TL_ICONS.check}</Icon>}
        </div>
      ))}
      <span style={{ height: 1, background: C.line, margin: '4px 6px' }} />
      <button type="button" role="menuitem" style={item} disabled={p.readOnly}
        onClick={() => { p.edit((project) => newCut(project, { name: FULL_CUT_NAME })); startRename(FULL_CUT_NAME); }}>
        <Icon>{TL_ICONS.plus}</Icon>New cut from the full recording
      </button>
      <button type="button" role="menuitem" style={item} disabled={p.readOnly}
        onClick={() => { p.edit((project) => duplicateCut(project, { id: current.id, name: current.name })); startRename(current.name); }}>
        <Icon>{TL_ICONS.copy}</Icon>{`Duplicate ${quote(current.name)}`}
      </button>
      <button type="button" role="menuitem" style={item} disabled={p.readOnly} onClick={() => startRename(current.name)}>
        <Icon>{TL_ICONS.text}</Icon>Rename
      </button>
      <button type="button" role="menuitem" style={{ ...item, opacity: p.project.cuts.length > 1 ? 1 : 0.45 }} disabled={p.readOnly || p.project.cuts.length <= 1}
        onClick={() => p.edit((project) => deleteCut(project, { id: current.id }))}>
        <Icon>{TL_ICONS.trash}</Icon>{`Delete ${quote(current.name)}`}
      </button>
      <span style={{ fontSize: 11.5, color: C.muted, padding: '6px 10px', lineHeight: 1.45 }}>Every cut shares the same recording. Edits in one cut never change another.</span>
    </div>
  );
}
