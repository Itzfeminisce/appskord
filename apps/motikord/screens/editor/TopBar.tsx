import { useRef, useState } from 'react';
import { canRedo, canUndo } from '../../lib/editor/history';
import { rename, setAspect } from '../../lib/editor/store';
import { ASPECTS } from '../../lib/recipe/validate';
import { goInSidePanel, useWindowId } from '../../lib/sidepanelGo';
import { useEditor } from './Editor';
import { useIssues } from '../Checker';
import { SaveStatusLine } from './StatesEditor';

const linkStyle = {
  height: 36, padding: '0 12px', borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)',
  font: '500 13px/1 var(--font)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
} as const;
const iconStyle = (on: boolean) => ({ width: 36, height: 36, color: on ? 'var(--ink)' : 'var(--line-strong)' });

export function TopBar() {
  const { state, brand, save, edit, undo, redo, go } = useEditor();
  const r = state.clip.recipe;
  const h = { past: state.clip.history, future: state.future };
  const [name, setName] = useState(r.name);
  const [focused, setFocused] = useState(false);
  // Escape leaves the field without saving what was typed.
  const cancelled = useRef(false);
  // Your clips live in the side panel; it opens inside the click.
  const win = useWindowId();
  const shown = focused ? name : r.name;
  const count = useIssues().cards.length;
  const dot = brand?.colours.find((c) => c.role === 'primary')?.hex ?? brand?.colours[0]?.hex;

  const commitName = (v: string) => {
    const clean = v.trim();
    if (clean && clean !== r.name) edit(rename(r, clean));
  };

  return (
    <header style={{ height: 52, flexShrink: 0, background: 'var(--surface)', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px' }}>
      <button type="button" aria-label="Your clips" onClick={() => goInSidePanel(win.current, 'Library')} style={{ width: 36, height: 36, border: 0, borderRadius: 9, background: 'var(--ink)', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M3 8.5h5M2 12h6M3 15.5h5" /><circle cx="15.5" cy="12" r="4.5" fill="var(--accent)" stroke="none" /></svg>
      </button>
      <input
        aria-label="Clip name" value={shown} maxLength={80}
        onFocus={() => { setName(r.name); setFocused(true); }}
        onChange={(e) => setName(e.target.value)}
        onBlur={(e) => { setFocused(false); if (cancelled.current) cancelled.current = false; else commitName(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { cancelled.current = true; setName(r.name); e.currentTarget.blur(); } }}
        style={{ width: 200, height: 34, border: '1px solid transparent', borderRadius: 8, padding: '0 8px', font: '600 15px/1 var(--font)', color: 'var(--ink)', background: focused ? 'var(--surface)' : 'transparent', outlineColor: 'var(--accent)' }}
      />
      <SaveStatusLine status={save} />
      <span style={{ width: 1, height: 24, background: 'var(--line)', margin: '0 4px' }} />
      <button type="button" className="icon-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo(h)} onClick={undo} style={iconStyle(canUndo(h))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>
      </button>
      <button type="button" className="icon-btn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo(h)} onClick={redo} style={iconStyle(canRedo(h))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>
      </button>
      <div style={{ flexGrow: 1 }} />
      <div role="radiogroup" aria-label="Size" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: 'var(--stage)' }}>
        {ASPECTS.map((a) => {
          const on = r.aspect === a;
          return (
            <button
              key={a} type="button" role="radio" aria-checked={on}
              onClick={() => edit(setAspect(r, a), { toast: true })}
              style={{ height: 30, padding: '0 10px', border: 0, borderRadius: 6, background: on ? 'var(--surface)' : 'transparent', boxShadow: on ? '0 1px 2px rgba(16,16,20,0.08)' : 'none', font: `500 12px/1 var(--mono)`, color: on ? 'var(--ink)' : 'var(--muted)', cursor: 'pointer' }}
            >{a}</button>
          );
        })}
      </div>
      <button type="button" style={linkStyle} onClick={() => go('Formats')}>All sizes</button>
      <button type="button" style={linkStyle} onClick={() => go('BrandKit')}>
        {dot && <span style={{ width: 12, height: 12, borderRadius: '50%', background: dot }} />}Brand
      </button>
      <button type="button" data-slot="check-count" style={linkStyle} onClick={() => go('Checker')}>
        Check{count > 0 && <span aria-label={`${count} to fix`} style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9, background: 'var(--accent)', color: '#fff', font: '600 11px/18px var(--font)', textAlign: 'center' }}>{count}</span>}
      </button>
      <button type="button" className="btn btn-primary" onClick={() => go('Export')} style={{ height: 36, padding: '0 16px', borderRadius: 9, fontSize: 13, fontWeight: 600, gap: 6 }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14" /></svg>Export
      </button>
    </header>
  );
}
