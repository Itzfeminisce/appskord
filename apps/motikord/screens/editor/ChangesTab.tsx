import { useEffect, useMemo, useState } from 'react';
import { madeLine, newestFirst, sceneOf, splitSummary, statesAfter, whenLabel, whoLabel } from '../../lib/editor/changes';
import { restTime } from '../../lib/editor/store';
import { getPack } from '../../lib/templates/scenes';
import type { Change } from '../../lib/types';
import { useEditor } from './Editor';
import { PanelTabs } from './PanelTabs';
import { SceneThumb, thumbSize } from './SceneThumb';

// ChangesV2: every change newest first, who made it and when, with a thumbnail. Undo on the newest, "Go back here" on
// the others; going back keeps the later changes (muted) so you can come forward again.

const small = {
  height: 26, padding: '0 10px', border: '1px solid var(--line-strong)', borderRadius: 7, background: 'var(--surface)', color: 'var(--ink)',
  font: '500 12px/1 var(--font)', cursor: 'pointer', flexShrink: 0,
} as const;

export function ChangesTab(_: { onLayer?: () => void } = {}) {
  const { state, undo, redo, goBack } = useEditor();
  const [now, setNow] = useState(Date.now);
  // "now" turns into "1 min ago" while the tab stays open.
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  useEffect(() => setNow(Date.now()), [state.clip.history]);
  const r = state.clip.recipe;
  const past = state.clip.history;
  const list = newestFirst(past);
  const after = useMemo(() => statesAfter(r, past), [r, past]);
  // Undone changes, the next one to redo last in the stack: shown above, newest at the top.
  const ahead = state.future;
  const forward = (c: Change) => {
    const j = ahead.findIndex((x) => x.id === c.id);
    for (let k = ahead.length - 1; k >= j && j >= 0; k--) redo();
  };
  const thumb = thumbSize(r.aspect, 40);
  const shot = (doc: typeof r | undefined, c?: Change) => {
    if (!doc) return <span style={{ width: thumb.w, height: thumb.h, flexShrink: 0 }} />;
    const si = Math.min(doc.scenes.length - 1, Math.max(0, (c && sceneOf(c)) ?? 0));
    return <SceneThumb recipe={doc} aspect={doc.aspect} timeMs={restTime(doc, si)} w={thumb.w} h={thumb.h} />;
  };
  const row = (c: Change, doc: typeof r | undefined, kind: 'now' | 'past' | 'ahead') => {
    const { title, detail } = splitSummary(c.summary);
    const on = kind === 'now';
    return (
      <li key={c.id} style={{ padding: '10px 12px', borderRadius: 10, background: on ? 'var(--tint)' : undefined, border: `1px solid ${on ? 'var(--tint-strong)' : 'var(--line)'}`, display: 'flex', gap: 10, opacity: kind === 'ahead' ? 0.6 : 1 }}>
        {shot(doc, c)}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flexGrow: 1 }}>
          <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600, overflowWrap: 'anywhere' }}>{title}</span>
            {on && <span style={{ padding: '1px 6px', borderRadius: 5, background: 'var(--accent)', color: '#fff', font: '600 10px/1.4 var(--font)' }}>Now</span>}
          </span>
          {detail && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{detail}</span>}
          <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--faint)' }}><span style={{ fontWeight: 600, color: 'var(--muted)' }}>{whoLabel(c.by)}</span>{` · ${whenLabel(c.at, now)}`}</span>
            {on
              ? <button type="button" onClick={undo} style={small}>Undo</button>
              : <button type="button" onClick={() => (kind === 'ahead' ? forward(c) : goBack(c.id))} style={small}>Go back here</button>}
          </span>
        </span>
      </li>
    );
  };
  const style = r.style ? getPack(r.style)?.name : undefined;
  return (
    <>
      <PanelTabs on="changes" />
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Changes</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>Newest first</span>
      </span>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ahead.map((c) => row(c, undefined, 'ahead'))}
        {list.map((c, i) => row(c, after[i], i === 0 ? 'now' : 'past'))}
        <li style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--line)', display: 'flex', gap: 10, background: list.length === 0 ? 'var(--tint)' : undefined }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, flexGrow: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Clip made</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{madeLine(r, style)}</span>
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--faint)' }}>{whenLabel(state.clip.createdAt, now)}</span>
              {list.length > 0 && <button type="button" onClick={() => { goBack(list[list.length - 1]!.id); undo(); }} style={small}>Go back here</button>}
            </span>
          </span>
        </li>
      </ol>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: 'var(--faint)' }}>Going back keeps the later changes in this list, so you can come forward again.</p>
    </>
  );
}
