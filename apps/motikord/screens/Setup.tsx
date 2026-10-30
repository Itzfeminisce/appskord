import { useEffect, useRef, useState, type ReactNode } from 'react';
import { frameStats } from '../lib/check/stats';
import { previewVerdict, supportVerdict, type Verdict } from '../lib/check/verdict';
import { CODECS } from '../lib/check/plan';
import { Button } from '../components/ui';
import { useRouter } from '../entrypoints/sidepanel/router';
import { getSettings, updateSettings } from '../lib/settings';
import type { AiMode } from '../lib/types';
import { NoBuiltInAi, NoFastExport, SlowComputer } from './StatesSetup';

/** Shared by the first-run screens: the page frame, the back arrow and the pinned footer. */
export function Page({ frame, children }: { frame: string; children: ReactNode }) {
  return <main data-frame={frame} style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>{children}</main>;
}

export function StepHead({ step, onBack }: { step: 1 | 2; onBack: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px 0' }}>
      <BackButton onBack={onBack} />
      <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>Step {step} of 2</span>
    </div>
  );
}

export function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" aria-label="Back" onClick={onBack} className="icon-btn" style={{ width: 36, height: 36, marginLeft: -8, borderRadius: 10, color: 'var(--ink)' }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
    </button>
  );
}

export function Title({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ padding: '12px 24px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h1 style={{ margin: 0, fontSize: 26, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.02em' }}>{title}</h1>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>{children}</p>
    </div>
  );
}

export function Footer({ children }: { children: ReactNode }) {
  return <div style={{ marginTop: 'auto', padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>;
}

/** The sentence under a disabled primary button. */
export const hintStyle = { fontSize: 12, color: 'var(--faint)', textAlign: 'center' } as const;

export interface Machine { preview: Verdict; fastExport: Verdict; builtInAi: boolean }

/** Which Setup rows are ready and which state cards show. Pure, so forced inputs render every state. */
export function machineNotes(m: Machine | null) {
  if (!m) return { previewReady: false, exportReady: false, aiReady: false, cards: [] as ('no-built-in-ai' | 'slow-computer' | 'no-fast-export')[] };
  const cards: ('no-built-in-ai' | 'slow-computer' | 'no-fast-export')[] = [];
  if (!m.builtInAi) cards.push('no-built-in-ai');
  if (m.preview !== 'Pass') cards.push('slow-computer');
  if (m.fastExport !== 'Pass') cards.push('no-fast-export');
  return { previewReady: m.preview === 'Pass', exportReady: m.fastExport === 'Pass', aiReady: m.builtInAi, cards };
}

/** A short live version of the T0 machine check: about one second of drawing, one encoder query, one AI query. */
export async function probeMachine(): Promise<Machine> {
  return { preview: await probePreview(), fastExport: await probeExport(), builtInAi: await probeAi() };
}

async function probePreview(): Promise<Verdict> {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) return 'Fail';
  const intervals: number[] = [];
  await new Promise<void>((done) => {
    let start = 0;
    let last = 0;
    const tick = (now: number) => {
      if (!start) start = last = now;
      else intervals.push(now - last);
      last = now;
      const t = (now - start) / 1000;
      ctx.fillStyle = '#111114';
      ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = '#BE185D';
      ctx.fillRect(100 + 600 * Math.abs(Math.sin(t * 2)), 200, 360, 240);
      ctx.fillStyle = '#fff';
      ctx.font = '600 72px sans-serif';
      ctx.fillText('Motikord', 120 + 80 * Math.sin(t * 3), 360);
      if (now - start < 1000) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });
  return intervals.length < 5 ? 'Pass' : previewVerdict(frameStats(intervals).meanFps);
}

async function probeExport(): Promise<Verdict> {
  if (typeof VideoEncoder === 'undefined') return 'Fail';
  try {
    const r = await VideoEncoder.isConfigSupported({ codec: CODECS.h264, width: 1920, height: 1080, framerate: 30, hardwareAcceleration: 'prefer-hardware' });
    return supportVerdict(!!r.supported);
  } catch {
    return 'Fail';
  }
}

async function probeAi(): Promise<boolean> {
  const lm = (globalThis as { LanguageModel?: { availability(): Promise<string> } }).LanguageModel;
  try { return (await lm?.availability()) === 'available'; } catch { return false; }
}

/** "Ready" in green, or a muted dash when the check did not pass (the cards below say why). */
export function RowStatus({ ready }: { ready: boolean }) {
  return ready
    ? <span style={{ color: 'var(--success-ink)', fontWeight: 500 }}>Ready</span>
    : <span aria-hidden="true" style={{ color: 'var(--faint)' }}>–</span>;
}

export function MachineCard({ machine }: { machine: Machine | null }) {
  const n = machineNotes(machine);
  const rows: [string, boolean][] = [['Smooth preview', n.previewReady], ['Fast video export', n.exportReady], ['Chrome’s built-in AI', n.aiReady]];
  return (
    <div style={{ padding: '14px 16px', borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>This computer</span>
      {rows.map(([label, ready]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span>{label}</span><RowStatus ready={ready} /></div>
      ))}
    </div>
  );
}

function Choice({ checked, disabled, onPick, name, children }: { checked: boolean; disabled?: boolean; onPick: () => void; name: string; children: ReactNode }) {
  return (
    <label style={{ padding: 16, borderRadius: 16, background: 'var(--surface)', border: checked ? '2px solid var(--accent)' : '1px solid var(--line)', display: 'flex', gap: 12, alignItems: 'flex-start', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1, margin: checked ? 0 : 1 }}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onPick} style={{ margin: '3px 0 0', accentColor: 'var(--accent)', width: 16, height: 16 }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</span>
    </label>
  );
}

export default function Setup() {
  const { back, navigate, replace } = useRouter();
  const [ai, setAi] = useState<AiMode>('cloud');
  const [machine, setMachine] = useState<Machine | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    getSettings().then((s) => alive.current && setAi(s.ai)).catch((error: unknown) => console.error('Motikord: could not read settings', error));
    probeMachine().then((m) => alive.current && setMachine(m)).catch((error: unknown) => console.error('Motikord: could not check this computer', error));
    return () => { alive.current = false; };
  }, []);

  const notes = machineNotes(machine);
  const noLocalAi = machine !== null && !machine.builtInAi;
  const picked: AiMode = noLocalAi ? 'cloud' : ai;

  async function next(mode: AiMode) {
    try {
      if (mode === 'cloud') {
        await updateSettings({ ai: 'cloud' });
        navigate('PenvConnect');
      } else {
        await updateSettings({ ai: 'local', onboarded: true });
        replace('Home');
      }
    } catch (error) {
      console.error('Motikord: could not save the AI choice', error);
    }
  }

  return (
    <Page frame="Setup">
      <StepHead step={1} onBack={back} />
      <Title title="Choose who writes your clips">Motikord’s AI turns your words into a clip plan. Only your prompt and the clip’s text are sent. Your media never is.</Title>
      <div role="radiogroup" aria-label="Who writes your clips" style={{ margin: '18px 24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Choice name="ai" checked={picked === 'cloud'} onPick={() => setAi('cloud')}>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Faster with Groq</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-hover)', background: 'var(--tint-strong)', padding: '2px 8px', borderRadius: 999 }}>Recommended</span>
          </span>
          <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>A clip in a few seconds, and the best results. Free to start. Your key comes from Penv Cloud or you paste it.</span>
        </Choice>
        <Choice name="ai" checked={picked === 'local'} disabled={noLocalAi} onPick={() => setAi('local')}>
          <span style={{ fontSize: 15, fontWeight: 600 }}>On this computer</span>
          <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>Uses Chrome’s built-in AI. Nothing is sent, no key needed. Slower, and clips are simpler.</span>
        </Choice>
      </div>
      <div style={{ margin: '14px 24px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <MachineCard machine={machine} />
        {notes.cards.includes('no-built-in-ai') && <NoBuiltInAi onUseGroq={() => void next('cloud')} />}
        {notes.cards.includes('slow-computer') && <SlowComputer />}
        {notes.cards.includes('no-fast-export') && <NoFastExport />}
      </div>
      <Footer><Button block onClick={() => void next(picked)}>Continue</Button></Footer>
    </Page>
  );
}
