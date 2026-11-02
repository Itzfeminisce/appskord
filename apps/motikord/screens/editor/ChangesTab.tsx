import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { madeBy, madeState, madeSummary, newestFirst, sceneOf, splitSummary, statesAfter, whenLabel, whoLabel } from '../../lib/editor/changes';
import { restTime } from '../../lib/editor/store';
import type { Change } from '../../lib/types';
import { useSettings } from '../../lib/makeClip';
import { BackHere, UndoIcon } from './dialogIcons';
import { useEditor } from './Editor';
import { PanelTabs } from './PanelTabs';
import { SceneThumb, thumbSize } from './SceneThumb';

// ChangesV2: every change newest first, who made it and when, with a thumbnail. Undo on the newest, "Go back here" on
// the others; going back keeps the later changes (muted) so you can come forward again.

const small = {
  alignSelf: 'flex-start', marginTop: 3, height: 26, padding: '0 10px', border: '1px solid #E0E0E4', borderRadius: 7, background: 'var(--surface)', color: 'var(--ink)',
  font: '500 12px/1 var(--font)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5,
} as const;

/** The panel's inner height, so the footer note can sit at its bottom. */
function usePanelHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [h, setH] = useState<number>();
  useLayoutEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const read = () => { const cs = getComputedStyle(host); setH(host.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)); };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);
  return { ref, h };
}

export function ChangesTab(_: { onLayer?: () => void } = {}) {
  const { state, undo, redo, goBack } = useEditor();
  const settings = useSettings();
  const [now, setNow] = useState(Date.now);
  const [hover, setHover] = useState<string>();
  const panel = usePanelHeight();
  // "now" turns into "1 min ago" while the tab stays open.
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(id); }, []);
  useEffect(() => setNow(Date.now()), [state.clip.history]);
  const r = state.clip.recipe;
  const past = state.clip.history;
  const list = newestFirst(past);
  const after = useMemo(() => statesAfter(r, past), [r, past]);
  // The clip as it was made, for the "Clip made" thumbnail.
  const first = useMemo(() => madeState(r, past), [r, past]);
  // Undone changes, the next one to redo last in the stack: shown above, newest at the top.
  const ahead = state.future;
  const forward = (c: Change) => {
    const j = ahead.findIndex((x) => x.id === c.id);
    for (let k = ahead.length - 1; k >= j && j >= 0; k--) redo();
  };
  const thumb = thumbSize(r.aspect, 46);
  const shot = (doc: typeof r | undefined, c?: Change) => {
    const si = doc ? Math.min(doc.scenes.length - 1, Math.max(0, (c && sceneOf(c)) ?? 0)) : 0;
    return (
      <span aria-hidden="true" style={{ width: thumb.w, height: thumb.h, flexShrink: 0, borderRadius: 4, overflow: 'hidden', boxShadow: 'inset 0 0 0 1px rgba(16,16,20,0.08)', background: 'var(--stage)', display: 'flex' }}>
        {doc && <SceneThumb recipe={doc} aspect={doc.aspect} timeMs={restTime(doc, si)} w={thumb.w} h={thumb.h} />}
      </span>
    );
  };
  // The vertical line from this entry's thumbnail down to the next one.
  const connector = <span aria-hidden="true" style={{ position: 'absolute', left: 8 + thumb.w / 2 - 1, top: 8 + thumb.h + 4, bottom: -4, width: 2, background: 'var(--stage)' }} />;
  const who = (name: string | undefined, at: number) => (
    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{name ? <><span style={{ fontWeight: 600, color: '#3F3F46' }}>{name}</span>{` · ${whenLabel(at, now)}`}</> : whenLabel(at, now)}</span>
  );
  const entry = (key: string, on: boolean, muted: boolean, last: boolean, body: ReactNode, thumbnail: ReactNode) => (
    <li key={key} onPointerEnter={() => setHover(key)} onPointerLeave={() => setHover(undefined)} onFocus={() => setHover(key)}
      style={{ position: 'relative', display: 'flex', gap: 10, padding: 8, margin: '0 -8px', borderRadius: 10, background: on ? 'var(--tint)' : undefined, opacity: muted ? 0.6 : 1 }}>
      {thumbnail}
      {!last && connector}
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flexGrow: 1 }}>{body}</span>
    </li>
  );
  const title = (text: string, on: boolean) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
      {text}
      {on && <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--accent-hover)', background: 'var(--tint-strong)', borderRadius: 4, padding: '1px 5px' }}>Now</span>}
    </span>
  );
  const row = (c: Change, doc: typeof r | undefined, kind: 'now' | 'past' | 'ahead', i: number) => {
    const { title: head, detail } = splitSummary(c.summary);
    const on = kind === 'now';
    // "Go back here" shows on the entry just under Now, and on any other when pointed at or focused.
    const offer = kind === 'ahead' || (kind === 'past' && (i === 1 || hover === c.id));
    return entry(c.id, on, kind === 'ahead', false, <>
      {title(head, on)}
      {who(whoLabel(c.by), c.at)}
      {detail && <span style={{ fontSize: 11, color: 'var(--faint)' }}>{detail}</span>}
      {on && <button type="button" onClick={undo} style={small}><UndoIcon />Undo</button>}
      {offer && <button type="button" onClick={() => (kind === 'ahead' ? forward(c) : goBack(c.id))} style={small}><BackHere />Go back here</button>}
    </>, shot(doc, c));
  };
  return (
    <div ref={panel.ref} style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: panel.h }}>
      <PanelTabs on="changes" />
      <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Changes</span>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>Newest first</span>
      </span>
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {ahead.map((c, i) => row(c, undefined, 'ahead', i))}
        {list.map((c, i) => row(c, after[i], i === 0 ? 'now' : 'past', i))}
        {entry('made', list.length === 0, false, true, <>
          {title('Clip made', list.length === 0)}
          {who(madeBy(r, settings), state.clip.createdAt)}
          <span style={{ fontSize: 11, color: 'var(--faint)' }}>{madeSummary(r, past)}</span>
          {list.length > 0 && (list.length === 1 || hover === 'made') && <button type="button" onClick={() => { goBack(list[list.length - 1]!.id); undo(); }} style={small}><BackHere />Go back here</button>}
        </>, shot(first))}
      </ol>
      <p style={{ margin: 'auto 0 0', paddingTop: 12, borderTop: '1px solid var(--line)', fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>Going back keeps the later changes in this list, so you can come forward again.</p>
    </div>
  );
}
