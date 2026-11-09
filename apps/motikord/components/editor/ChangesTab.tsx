import { useEffect, useState } from 'react';
import { newestFirst, splitSummary } from '../../lib/editor/changes';
import { PROVIDERS } from '../../lib/providers';
import { RESTYLE } from '../../lib/restyle/restyle';
import type { Author, Change } from '../../lib/types';
import { useEditorV3 } from './context';
import { goBackTo, redoV3 } from './model';
import { C, hint, quietButton } from './ui';

// ChangesV3: every change newest first, who made it and when. Undo on the newest, "Go back here" on the others;
// going back keeps the later changes so you can come forward again. The v2 version is kept below.

export const GOING_BACK = 'Going back keeps the later changes in this list, so you can come forward again.';

/** "You", "Groq", "Quality check": who made a change, as ChangesV3 names them. */
export function whoV3(by: Author): string | undefined {
  switch (by) {
    case 'hand': return 'You';
    case 'check': return 'Quality check';
    case 'builtin': return 'built-in AI';
    case 'template': return undefined;
    default: return PROVIDERS[by].label;
  }
}

/** "now", then "1 min ago". */
export function whenV3(at: number, now: number): string {
  const min = Math.floor(Math.max(0, now - at) / 60_000);
  return min < 1 ? 'now' : `${min} min ago`;
}

const isRestyle = (c: Change) => c.patch.some((op) => op.path === '/v3');

export function ChangesTab({ onOpenV2 }: { onOpenV2?: () => void }) {
  const ed = useEditorV3();
  const { state } = ed;
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  useEffect(() => setNow(Date.now()), [state.clip.history]);
  const list = newestFirst(state.clip.history);
  const row = (c: Change, i: number, ahead: boolean) => {
    const { title, detail } = splitSummary(c.summary);
    const who = whoV3(c.by);
    return (
      <li key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '8px 0', borderBottom: '1px solid #EFEFF1', opacity: ahead ? 0.55 : 1 }}>
        <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'pre-wrap' }}>{title}</span>
        {isRestyle(c) && <span style={hint}>{RESTYLE.keptHere}</span>}
        {detail && <span style={hint}>{detail}</span>}
        <span style={{ fontSize: 11, color: C.muted }}>
          {who && <span style={{ fontWeight: 600, color: '#3F3F46' }}>{who}</span>}
          {` · ${whenV3(c.at, now)}`}
        </span>
        {ahead ? (
          <button type="button" style={{ ...quietButton, alignSelf: 'flex-start', marginTop: 3 }} onClick={() => {
            const n = state.future.length - state.future.findIndex((x) => x.id === c.id);
            ed.update((st) => { let out = st; for (let k = 0; k < n; k++) out = redoV3(out); return out; });
          }}>Redo</button>
        ) : i === 0 ? (
          <button type="button" style={{ ...quietButton, alignSelf: 'flex-start', marginTop: 3 }} onClick={ed.undo}>Undo</button>
        ) : (
          <button type="button" style={{ ...quietButton, alignSelf: 'flex-start', marginTop: 3 }} onClick={() => ed.update((st) => goBackTo(st, c.id))}>Go back here</button>
        )}
      </li>
    );
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <span style={{ fontSize: 11, color: C.muted, padding: '4px 0 6px' }}>Newest first</span>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {state.future.map((c) => row(c, -1, true))}
        {list.map((c, i) => row(c, i, false))}
      </ul>
      {state.clip.v2Version && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 0', borderTop: '1px solid #E8E8EB' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4 }}>Kept versions</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{RESTYLE.v2Name}</span>
          <span style={hint}>{RESTYLE.v2Line}</span>
          {onOpenV2 && <button type="button" style={{ ...quietButton, alignSelf: 'flex-start' }} onClick={onOpenV2}>{RESTYLE.open}</button>}
        </div>
      )}
      <p style={{ ...hint, margin: '8px 0 0' }}>{GOING_BACK}</p>
    </div>
  );
}
