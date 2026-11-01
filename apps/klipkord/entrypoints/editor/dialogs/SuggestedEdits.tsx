import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { currentCut } from '@/lib/project/history';
import { applyWin, applyWins, lengths, quickWins, seeQuickWins, type QuickWin, type QuickWinKind } from '@/lib/project/suggest';
import type { SlotProps } from '../components/slots';
import { clock } from '../format';
import { useEvents } from '../transcript/events';
import { ICON } from '../transcript/icons';
import { outAt } from '../transcript/model';
import { QUICK_WINS_KEY, setUi, useUi } from '../transcript/store';
import { C, Icon, iconButton } from '../ui';

const KIND_ICON: Record<QuickWinKind, keyof typeof ICON> = { fillers: 'cut', retake: 'retake', pauses: 'speed', zooms: 'zoom' };

const BUTTON: CSSProperties = {
  height: 28, padding: '0 12px', borderRadius: 8, background: C.raised, color: C.text, border: `1px solid ${C.line}`, fontFamily: 'inherit', fontSize: 13,
  fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap', boxSizing: 'border-box',
};

/** PanelOpen's card asked for the quick wins of `id`: true once, and the ask is cleared. */
function takeAsk(id: string): boolean {
  try {
    if (localStorage.getItem(QUICK_WINS_KEY) !== id) return false;
    localStorage.removeItem(QUICK_WINS_KEY);
    return true;
  } catch {
    return false;
  }
}

/** SuggestedEdits: local quick wins on the first open of a new recording, and again from PanelOpen's card. */
export function SuggestedEdits({ recording, project, ready, readOnly, seek, play, edit }: SlotProps) {
  const ui = useUi();
  const events = useEvents(project);
  const [closed, setClosed] = useState(false);
  const id = project.id;

  useEffect(() => {
    if (takeAsk(id)) setUi({ quickWins: true });
    const onStorage = (e: StorageEvent) => { if (e.key === QUICK_WINS_KEY && takeAsk(id)) { setClosed(false); setUi({ quickWins: true }); } };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [id]);

  const wanted = ready && !readOnly && !closed && events !== undefined && (project.quickWins === 'new' || ui.quickWins);
  const wins = useMemo(() => (wanted ? quickWins(project, recording.transcript, events, recording.duration) : []), [wanted, project, recording, events]);
  const { before, after } = useMemo(() => (wins.length ? lengths(project, wins) : { before: 0, after: 0 }), [project, wins]);

  const close = () => {
    setClosed(true);
    setUi({ quickWins: false });
    if (project.quickWins === 'new') edit(seeQuickWins);
  };
  // Nothing to suggest: the first open passes quietly.
  useEffect(() => {
    if (wanted && wins.length === 0) close();
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!wanted) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!wanted || wins.length === 0) return null;

  const show = (w: QuickWin) => { seek(outAt(currentCut(project), w.at)); play(); };
  const apply = (w: QuickWin) => edit((p) => applyWin(p, w));
  const applyAll = () => {
    edit((p) => seeQuickWins(applyWins(p, wins)));
    setClosed(true);
    setUi({ quickWins: false });
  };
  const n = wins.length;

  return (
    <div role="dialog" aria-label="Quick wins" style={{
      position: 'fixed', top: 56, right: 12, width: 420, zIndex: 6, borderRadius: 14, background: C.panel, border: `1px solid ${C.line}`,
      boxShadow: '0 24px 60px rgba(0,0,0,0.55)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10, boxSizing: 'border-box', color: C.text,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ flexGrow: 1 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{`${n} ${n === 1 ? 'quick win' : 'quick wins'} for this video`}</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12.5, color: C.secondary }}>{`Together they take it from ${clock(before)} to ${clock(after)}. Nothing changes until you apply.`}</p>
        </div>
        <button type="button" aria-label="Close (Esc)" title="Close (Esc)" onClick={close} style={iconButton(30)}><Icon>{ICON.close}</Icon></button>
      </div>
      {wins.map((w) => (
        <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 10, background: C.raised, border: `1px solid ${C.line}` }}>
          <span style={{ width: 32, height: 32, borderRadius: 8, background: C.ground, color: C.accentText, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Icon>{ICON[KIND_ICON[w.kind]]}</Icon>
          </span>
          <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{w.title}</span>
            <span style={{ fontSize: 12, color: C.secondary }}>{w.detail}</span>
          </span>
          <button type="button" onClick={() => show(w)} style={{ height: 28, padding: '0 8px', border: 0, background: 'transparent', color: C.secondary, fontFamily: 'inherit', fontSize: 12, whiteSpace: 'nowrap', cursor: 'pointer' }}>Show me</button>
          <button type="button" onClick={() => apply(w)} style={BUTTON}><span>Apply</span></button>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <span style={{ fontSize: 12, color: C.muted, flexGrow: 1 }}>One Undo reverts all of them.</span>
        <button type="button" onClick={close} style={{ ...BUTTON, height: 32, background: 'transparent', color: C.secondary, border: 0 }}><span>Not now</span></button>
        <button type="button" onClick={applyAll} style={{ ...BUTTON, height: 32, background: C.accent, color: '#FFFFFF', border: 0 }}><span>{`Apply all ${n}`}</span></button>
      </div>
    </div>
  );
}
