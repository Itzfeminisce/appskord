import type { ReactNode } from 'react';
import { useRouter } from '../../entrypoints/sidepanel/router';
import { useSettings } from '../../lib/makeClip';
import { KEY_FRAMES, MAKING_MOTION, stateCopy } from '../../lib/pipeline/v3/states';
import { PROVIDERS } from '../../lib/providers';
import { AiFooter } from '../../screens/StatesCreate';
import { Button } from '../ui';
import { MAKING } from './copy';
import { flow, useFlow, type Stage } from './flow';
import { Still } from './Still';

type Step = 'done' | 'working' | 'waiting' | 'failed';
const order: Stage[] = ['keyframes', 'motion', 'checking', 'opening'];
const statusWord: Record<Step, string> = { done: 'Done', working: 'Working', waiting: 'Not started', failed: 'Failed' };

function Row({ step, title, children }: { step: Step; title: string; children?: ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <span role="img" aria-label={statusWord[step]} style={{ width: 20, height: 20, marginTop: 1, flexShrink: 0, borderRadius: '50%', display: 'grid', placeItems: 'center', border: step === 'waiting' ? '1.5px solid var(--line-strong)' : 0, background: step === 'done' ? 'var(--success-ink)' : step === 'working' ? 'var(--accent)' : step === 'failed' ? 'var(--error-ink)' : 'transparent', color: '#fff' }}>
        {step === 'done' && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}>
        <span style={{ fontSize: 14, fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>{title}</span>
        {children}
      </span>
    </li>
  );
}
const line = { fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' } as const;

/** MakingMotion: key frames approved, adding motion, the quality check, then the editor opens. */
export default function MakingMotion() {
  const { navigate } = useRouter();
  const state = useFlow();
  const settings = useSettings();
  const board = state.board;
  const total = board?.frames.length ?? 0;
  const at = state.scene?.at ?? 1;
  const reached = Math.max(0, order.indexOf(state.stage === 'motion-failed' ? 'motion' : state.stage === 'failed' ? 'opening' : state.stage));
  const stepOf = (i: number): Step => (reached > i ? 'done' : reached === i ? 'working' : 'waiting');
  const frame = board?.frames[Math.min(at, total) - 1];
  const canOpen = state.stage === 'checking' || state.stage === 'opening' || state.stage === 'failed';
  const by = settings?.ai === 'local' ? 'builtin' : (settings?.provider ?? 'groq');

  return (
    <main data-frame="MakingMotion" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 24px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.02em' }}>{MAKING_MOTION.title}</h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>{MAKING_MOTION.line}</p>
      </div>
      {frame && (
        <div style={{ margin: '16px 24px 0', display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 96, flexShrink: 0 }}>
            <Still frame={frame} ground={state.look.palette[0] ?? '#0B0B10'} ink={state.look.palette[1] ?? '#F5F5F7'} font={state.look.type.display} look={state.look} v2={state.recipe?.scenes[frame.index]} label={`Scene ${frame.index + 1} preview, moving: ${frame.words}`} width={96} height={170} />
          </div>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{`Scene ${frame.index + 1} · ${frame.name}`}</span>
            <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>{MAKING.fps} · {MAKING.finishing}</span>
          </span>
        </div>
      )}
      <ol style={{ listStyle: 'none', margin: '18px 0 0', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Row step={stepOf(0)} title={MAKING_MOTION.approved}><span className="mono" style={line}>{KEY_FRAMES.count(total, total)}</span></Row>
        <Row step={stepOf(1)} title={MAKING_MOTION.adding(at, state.scene?.total ?? total)}>
          {state.stage === 'motion-failed'
            ? <span role="alert" style={{ ...line, color: 'var(--error-ink)' }}>{stateCopy('motion-failed', { scene: (state.failedScene ?? 0) + 1 }).title}. {stateCopy('motion-failed', { scene: (state.failedScene ?? 0) + 1 }).line}{' '}
                <button type="button" onClick={() => { void flow.addTheMotion(); }} style={{ border: 0, background: 'none', padding: 0, font: '600 12px var(--font)', color: 'var(--accent-hover)', cursor: 'pointer' }}>{stateCopy('motion-failed').action}</button></span>
            : <span style={line}>{MAKING_MOTION.addingLine}</span>}
        </Row>
        <Row step={stepOf(2)} title={MAKING_MOTION.check}><span style={line}>{MAKING_MOTION.checkLine}</span></Row>
        <Row step={state.stage === 'failed' ? 'failed' : stepOf(3)} title={MAKING.opening}>
          {state.stage === 'failed'
            ? <span role="alert" style={{ ...line, color: 'var(--error-ink)' }}>{MAKING.openFailed}{' '}
                <button type="button" onClick={() => { void flow.openNow(); }} style={{ border: 0, background: 'none', padding: 0, font: '600 12px var(--font)', color: 'var(--accent-hover)', cursor: 'pointer' }}>{stateCopy('motion-failed').action}</button></span>
            : <span style={line}>{MAKING.openingLine}</span>}
        </Row>
      </ol>
      <div style={{ marginTop: 'auto', padding: '18px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Button variant="secondary" block disabled={!canOpen} aria-disabled={!canOpen} onClick={() => { void flow.openNow(); }}>{MAKING.openNow}</Button>
        <Button variant="ghost" block onClick={() => { flow.cancel(); navigate('LookLock'); }}>{MAKING.cancel}</Button>
        {by === 'builtin'
          ? <AiFooter by={by} />
          : <span style={{ textAlign: 'center', fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>{`Your words and up to 8 small frames go to ${PROVIDERS[by].label}. Your media stays on this computer.`}</span>}
      </div>
    </main>
  );
}
