import { useRouter } from '../../entrypoints/sidepanel/router';
import { getPackV3 } from '../../lib/look/packs';
import { KEY_FRAMES, stateCopy } from '../../lib/pipeline/v3/states';
import type { KeyFrame } from '../../lib/pipeline/v3';
import { useSettings } from '../../lib/makeClip';
import { KeyNeeded, Offline, ProviderDown, StoryboardFailed } from '../../screens/StatesCreate';
import { MakeFooter } from '../../screens/StatesCreate';
import { BackButton } from '../../screens/Setup';
import { Button } from '../ui';
import { LOOK_LOCK } from './copy';
import { flow, useFlow, type FlowState } from './flow';
import { Still } from './Still';

const quiet = { height: 36, padding: '0 12px', borderRadius: 9, border: '1px solid var(--line-input)', background: 'var(--surface)', color: 'var(--ink)', font: '500 13px var(--font)', cursor: 'pointer' } as const;

function Failure({ state }: { state: FlowState }) {
  const { navigate } = useRouter();
  const settings = useSettings();
  const provider = settings?.provider ?? 'groq';
  switch (state.failure?.state) {
    case 'key-needed': return <KeyNeeded onPasteKey={() => navigate('PasteKey')} />;
    case 'offline': return <Offline />;
    case 'provider-down': return <ProviderDown provider={provider} onOpenSettings={() => navigate('Settings')} />;
    default: return <StoryboardFailed provider={provider} onTryAgain={() => { void flow.retryPlan(); }} />;
  }
}

function Card({ frame, state }: { frame: KeyFrame; state: FlowState }) {
  const n = frame.index + 1;
  const drawing = state.drawing.includes(frame.index);
  const approved = frame.status === 'approved';
  const status = drawing ? KEY_FRAMES.drawingAnother : approved ? KEY_FRAMES.approved : KEY_FRAMES.waiting;
  const label = drawing ? `Scene ${n} still, drawing another` : `Scene ${n} still: ${frame.words}`;
  return (
    <li data-scene={n} style={{ padding: 10, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', gap: 12 }}>
      <div style={{ width: 96, flexShrink: 0 }}>
        <Still frame={frame} ground={state.look.palette[0] ?? '#0B0B10'} ink={state.look.palette[1] ?? '#F5F5F7'} font={state.look.type.display} look={state.look} v2={state.recipe?.scenes[frame.index]} label={label} width={96} height={170} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1, minWidth: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{String(n).padStart(2, '0')}</span>
          <span style={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>{frame.name}</span>
          <span role="status" style={{ fontSize: 11, fontWeight: 600, color: approved ? 'var(--success-ink)' : 'var(--muted)' }}>{status}</span>
        </span>
        <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>{frame.words}</span>
        {frame.status === 'failed' ? (
          <span role="alert" style={{ fontSize: 12, color: 'var(--error-ink)' }}>
            <strong>{stateCopy('keyframe-failed', { scene: n }).title}</strong> {stateCopy('keyframe-failed').line}{' '}
            <button type="button" onClick={() => { void flow.redraw(frame.index); }} style={{ ...quiet, height: 30 }}>{stateCopy('keyframe-failed').action}</button>
          </span>
        ) : (
          <span style={{ display: 'flex', gap: 6, marginTop: 'auto' }}>
            <button type="button" disabled={approved || drawing} onClick={() => { void flow.approve(frame.index); }} style={{ ...quiet, background: approved ? 'var(--tint)' : 'var(--surface)' }}>{KEY_FRAMES.approve}</button>
            <button type="button" disabled={drawing} onClick={() => { void flow.another(frame.index); }} style={quiet}>{KEY_FRAMES.tryAnother}</button>
          </span>
        )}
      </div>
    </li>
  );
}

/** LookLock, "Check the key frames": one still per scene; "Add the motion" waits until all are approved. */
export default function LookLock() {
  const { navigate, back } = useRouter();
  const state = useFlow();
  const settings = useSettings();
  const by = settings?.ai === 'local' ? 'builtin' : (settings?.provider ?? 'groq');
  const board = state.board;

  const head = (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '12px 12px 0' }}>
        <BackButton onBack={back} />
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{LOOK_LOCK.kicker}</span>
      </div>
      <div style={{ padding: '8px 24px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.02em' }}>{KEY_FRAMES.title}</h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>{KEY_FRAMES.line}</p>
      </div>
    </>
  );

  if (!board) {
    return (
      <main data-frame="LookLock" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
        {head}
        <div style={{ margin: '16px 16px 0' }}>
          {state.stage === 'plan-failed' ? <Failure state={state} /> : <p role="status" style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{stateCopy('keyframes-waiting').title}</p>}
        </div>
        <div style={{ margin: 'auto 16px 0', padding: '16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button variant="ghost" block onClick={() => { flow.cancel(); navigate('HomeV3'); }}>{LOOK_LOCK.cancel}</Button>
          <MakeFooter by={by} />
        </div>
      </main>
    );
  }

  const left = state.left ?? { count: `0/${board.frames.length}`, line: KEY_FRAMES.approveMore(board.frames.length) };
  const ready = !left.line;
  const seconds = Math.round((state.recipe?.scenes.reduce((s, x) => s + x.durationMs, 0) ?? 0) / 1000);
  return (
    <main data-frame="LookLock" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
      {head}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 24px 0' }}>
        <span style={{ fontSize: 13, color: 'var(--muted)', flexGrow: 1 }}>{LOOK_LOCK.sceneLine(board.frames.length, seconds, getPackV3(state.packId).name)}</span>
        <button type="button" onClick={() => { void flow.approveAll(); }} style={quiet}>{KEY_FRAMES.approveAll}</button>
      </div>
      <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: '0 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {board.frames.map((f) => <Card key={f.sceneId} frame={f} state={state} />)}
      </ul>
      <div style={{ marginTop: 'auto', padding: '18px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {left.line && (
          <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
            <span>{left.line}</span><span className="mono">{left.count}</span>
          </span>
        )}
        <Button block disabled={!ready} aria-disabled={!ready} onClick={() => { navigate('MakingMotion'); void flow.addTheMotion(); }} style={{ height: 48, fontSize: 15, fontWeight: 600, borderRadius: 12 }}>{KEY_FRAMES.addMotion}</Button>
        <span style={{ fontSize: 12, color: 'var(--faint)', textAlign: 'center' }}>{KEY_FRAMES.addMotionLine}</span>
        <Button variant="secondary" block onClick={() => navigate('LookBible')}>{LOOK_LOCK.changeLook}</Button>
        <Button variant="ghost" block onClick={() => { flow.clear(); navigate('HomeV3'); }}>{LOOK_LOCK.cancel}</Button>
        <MakeFooter by={by} />
      </div>
    </main>
  );
}
