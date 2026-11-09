import type { CSSProperties } from 'react';
import { QUALITY, type PassResult, type QualityNote, type QualityResult } from '../../lib/critic/v3';
import { KeyNeeded } from '../../screens/editor/StatesPrompt';
import { StateCard } from './StatesV3';

// CriticV3: the quality check's three passes, what it fixed for you, and the states a pass can end in.

export interface CriticV3Props {
  /** The clip's name. */
  name: string;
  result: QualityResult;
  /** "Groq". */
  provider: string;
  /** The button on a note: Merge scenes, Shorten it, Add depth ... */
  onFix?: (note: QualityNote) => void;
  onShow?: (note: QualityNote) => void;
  /** Undo one of "Fixed for you", by its place in the list. */
  onUndo?: (index: number) => void;
  onFixAll?: () => void;
  onCheckAgain?: () => void;
  onChangeModel?: () => void;
  onRetry?: () => void;
  onPasteKey?: () => void;
}

const small: CSSProperties = { height: 30, padding: '0 10px', border: '1px solid var(--line-input)', borderRadius: 8, background: 'var(--surface)', font: '600 12px var(--font)', color: 'var(--ink)', cursor: 'pointer' };

function NoteRow({ n, onFix, onShow }: { n: QualityNote; onFix?: (n: QualityNote) => void; onShow?: (n: QualityNote) => void }) {
  return (
    <li style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 14px', borderTop: '1px solid var(--line-soft)' }}>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {n.tag && <span style={{ height: 20, padding: '0 7px', borderRadius: 999, background: 'var(--tint)', color: 'var(--accent-hover)', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>{n.tag}</span>}
        <span style={{ fontSize: 13, fontWeight: 600 }}>{n.problem}</span>
      </span>
      {n.detail && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{n.detail}</span>}
      <span style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={() => onFix?.(n)} style={{ ...small, background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }}>{n.action}</button>
        <button type="button" onClick={() => onShow?.(n)} style={small}>Show me</button>
      </span>
    </li>
  );
}

function Pass({ i, p, p3 }: { i: number; p: PassResult; p3: CriticV3Props }) {
  return (
    <section aria-label={p.name} style={{ borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', overflow: 'hidden' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
        <span className="mono" style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--ink)', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 11 }}>{i + 1}</span>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, flexGrow: 1 }}>{p.name}</h2>
        {p.ran && <span style={{ fontSize: 12, color: 'var(--success-ink)', fontWeight: 600 }}>{QUALITY.ran}</span>}
        {p.ran && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{QUALITY.passToLookAt(p.notes.length)}</span>}
      </header>
      {p.state === 'critic-not-available' && <div style={{ padding: '0 14px 12px' }}><StateCard id="critic-not-available" onAction={p3.onChangeModel} /></div>}
      {p.state === 'critic-ai-failed' && <div style={{ padding: '0 14px 12px' }}><StateCard id="critic-ai-failed" provider={p3.provider} onAction={p3.onRetry} /></div>}
      {p.state === 'key-needed' && <div style={{ padding: '0 14px 12px' }}><KeyNeeded onPasteKey={p3.onPasteKey} /></div>}
      {p.notes.length > 0 && <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>{p.notes.map((n) => <NoteRow key={`${n.sceneIndex}-${n.kind}`} n={n} onFix={p3.onFix} onShow={p3.onShow} />)}</ul>}
    </section>
  );
}

/** CriticV3: "Quality check" with its three passes. */
export default function CriticV3(p: CriticV3Props) {
  const { result } = p;
  const frames = Math.max(0, ...result.passes.map((x) => x.frames));
  const left = result.toLookAt.length;
  return (
    <main data-frame="CriticV3" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 12, padding: '16px 16px 24px' }}>
      <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{QUALITY.title}</h1>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{`${p.name} · ${result.clip.scenes.length} scenes`}</span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>{`${QUALITY.toLookAt(left)} · ${QUALITY.fixedCount(result.fixed.length)}`}</span>
        {frames > 0 && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{QUALITY.looked(p.provider, frames)}</span>}
      </div>
      {result.passes.map((x, i) => <Pass key={x.id} i={i} p={x} p3={p} />)}
      {result.questions.map((q) => <StateCard key={q.sceneIndex} id="critic-fix-limit" scene={q.sceneIndex + 1} onAction={() => result.toLookAt.filter((n) => n.sceneIndex === q.sceneIndex).forEach((n) => p.onShow?.(n))} />)}
      {result.fixed.length > 0 && (
        <section aria-label={QUALITY.fixedTitle} style={{ borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', overflow: 'hidden' }}>
          <h2 style={{ margin: 0, padding: '12px 14px', fontSize: 14, fontWeight: 600 }}>{QUALITY.fixedTitle}</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {result.fixed.map((f, i) => (
              <li key={`${f.sceneIndex}-${f.kind}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderTop: '1px solid var(--line-soft)' }}>
                <span style={{ fontSize: 13, flexGrow: 1 }}>{f.line}</span>
                <button type="button" onClick={() => p.onUndo?.(i)} style={small}>{QUALITY.undo}</button>
              </li>
            ))}
          </ul>
          <p style={{ margin: 0, padding: '10px 14px', borderTop: '1px solid var(--line-soft)', fontSize: 12, color: 'var(--muted)' }}>{QUALITY.oneFix}</p>
        </section>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        {left > 0 && <button type="button" onClick={p.onFixAll} style={{ ...small, height: 40, flex: 1, background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }}>{QUALITY.fixAll(left)}</button>}
        <button type="button" onClick={p.onCheckAgain} style={{ ...small, height: 40, flex: 1 }}>{QUALITY.again}</button>
      </div>
    </main>
  );
}
