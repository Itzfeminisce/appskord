import { useEffect, useState } from 'react';
import { metaLine, newestFirst, splitSummary } from '../../lib/editor/changes';
import { useEditor } from './Editor';

// EditorPrompt frame, right panel: every change, newest first. Undo on the newest; "Go back here" on older ones.

const small = {
  height: 26, padding: '0 10px', border: '1px solid var(--line-strong)', borderRadius: 7, background: 'var(--surface)', color: 'var(--ink)',
  font: '500 12px/1 var(--font)', cursor: 'pointer', flexShrink: 0,
} as const;

export function ChangesTab({ onLayer }: { onLayer: () => void }) {
  const { state, undo, goBack } = useEditor();
  const [now, setNow] = useState(Date.now);
  // "Just now" turns into "1 min ago" while the tab stays open.
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  useEffect(() => setNow(Date.now()), [state.clip.history]);
  const list = newestFirst(state.clip.history);
  return (
    <>
      <div style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: 'var(--stage)' }}>
        <button type="button" onClick={onLayer} style={{ flex: 1, height: 28, border: 0, borderRadius: 6, background: 'transparent', font: '12px/1 var(--font)', color: 'var(--muted)', cursor: 'pointer' }}>Layer</button>
        <span aria-current="page" style={{ flex: 1, height: 28, borderRadius: 6, background: 'var(--surface)', boxShadow: '0 1px 2px rgba(16,16,20,0.08)', fontSize: 12, fontWeight: 600, display: 'grid', placeItems: 'center' }}>Changes</span>
      </div>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>Every change, by words or by hand. Go back to any point.</p>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {list.map((c, i) => {
          const { title, detail } = splitSummary(c.summary);
          const newest = i === 0;
          return (
            <li key={c.id} style={{ padding: '10px 12px', borderRadius: 10, background: newest ? 'var(--tint)' : undefined, border: `1px solid ${newest ? 'var(--tint-strong)' : 'var(--line)'}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{title}</span>
              {detail && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{detail}</span>}
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>{metaLine(c, now)}</span>
                {newest
                  ? <button type="button" onClick={undo} style={small}>Undo</button>
                  : <button type="button" onClick={() => goBack(c.id)} style={small}>Go back here</button>}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
