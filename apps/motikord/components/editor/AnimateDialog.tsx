import { useRef, useState } from 'react';
import { ANIMATE, animateLayer, type AnimateInput, type AnimateResult } from '../../lib/pipeline/v3/animateLayer';
import type { StateCopy } from '../../lib/pipeline/v3/states';
import type { Author } from '../../lib/types';
import { useEditorV3 } from './context';
import { editScene, undoV3, v2Layer } from './model';
import { C, hint, primaryButton, quietButton } from './ui';

// AnimateLayer: describe the motion; only the layer's settings go to the AI. The new tracks land in Changes.

const IDEAS = ['Type it on', 'Drop and settle', 'Glow on the key word'];

export type Animate = (input: AnimateInput, opts: { signal?: AbortSignal }) => Promise<AnimateResult>;

export function AnimateDialog({ animate = animateLayer, by = 'groq' }: { animate?: Animate; by?: Author }) {
  const ed = useEditorV3();
  const { layer, scene, state } = ed;
  const [words, setWords] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<StateCopy>();
  const ac = useRef<AbortController | undefined>(undefined);
  if (!layer) return null;
  const name = ed.name(layer);
  const text = ed.text(layer);
  const go = async () => {
    setBusy(true);
    setProblem(undefined);
    ac.current = new AbortController();
    try {
      const r = await animate({ scene, layerId: layer.id, words, name, v2: v2Layer(state.clip, state.scene, layer.id) }, { signal: ac.current.signal });
      if (!r.ok) {
        setProblem(r.copy);
        return;
      }
      const i = state.scene;
      ed.update((st) => editScene(st, i, () => r.scene, { summary: `${r.title}\n${r.line}`, by }));
      ed.setOverlay({ animated: { title: r.title, line: r.line } });
    } catch (error) {
      console.error('Motikord: could not animate layer', error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section role="dialog" aria-label={ANIMATE.title} style={{ position: 'absolute', right: 336, top: 64, width: 360, padding: 16, borderRadius: 16, background: C.surface, border: '1px solid #E8E8EB', boxShadow: '0 24px 64px rgba(16,16,20,0.22)', display: 'flex', flexDirection: 'column', gap: 10, zIndex: 20 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{ANIMATE.title}</span>
          <span style={hint}>{text ? `${name} · “${text.replace(/\s+/g, ' ')}”` : name}</span>
        </span>
        <button type="button" aria-label="Close" onClick={() => { ac.current?.abort(); ed.setOverlay(undefined); }} style={{ width: 28, height: 28, border: 0, borderRadius: 7, background: 'transparent', cursor: 'pointer' }}>×</button>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 12, color: C.muted }}>{ANIMATE.ask}</span>
        <textarea value={words} onChange={(e) => setWords(e.currentTarget.value)} rows={3} placeholder="e.g. letters drop in one by one and settle with a small bounce"
          style={{ resize: 'none', border: '1px solid #E0E0E4', borderRadius: 8, padding: 8, font: '400 13px/1.4 inherit' }} />
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {IDEAS.map((w) => <button key={w} type="button" style={quietButton} onClick={() => setWords(w)}>{w}</button>)}
      </div>
      {problem && (
        <div role="alert" style={{ padding: 10, borderRadius: 10, background: 'var(--warning-bg, #FFFBEB)', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontWeight: 600 }}>{problem.title}</span>
          <span>{problem.line}</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...hint, flex: 1 }}>{ANIMATE.undoNote}</span>
        <button type="button" style={primaryButton} disabled={busy || !words.trim()} onClick={() => void go()}>
          {problem?.action ?? ANIMATE.go}
        </button>
      </div>
      <p style={{ ...hint, margin: 0 }}>{ANIMATE.privacy(ed.provider)}</p>
    </section>
  );
}

/** "Headline animated · Per letter, Bouncy, 0.8 s." with Undo and Keep. */
export function AnimatedToast({ title, line }: { title: string; line: string }) {
  const ed = useEditorV3();
  return (
    <div role="status" style={{ position: 'absolute', left: '50%', top: 64, transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px 8px 14px', borderRadius: 12, background: '#111114', color: '#FFFFFF', fontSize: 13, zIndex: 20 }}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontWeight: 600 }}>{title}</span>
        <span style={{ opacity: 0.75, fontSize: 12 }}>{line}</span>
      </span>
      <button type="button" style={{ ...quietButton, background: 'transparent', color: '#FFFFFF', borderColor: '#3F3F46' }} onClick={() => { ed.update(undoV3); ed.setOverlay(undefined); }}>{ANIMATE.undo}</button>
      <button type="button" style={{ ...quietButton, background: '#FFFFFF' }} onClick={() => ed.setOverlay(undefined)}>{ANIMATE.keep}</button>
    </div>
  );
}
