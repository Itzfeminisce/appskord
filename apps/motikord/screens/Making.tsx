import { useEffect, type ReactNode } from 'react';
import { useRouter } from '../entrypoints/sidepanel/router';
import { Spinner } from '../components/ui';
import { HOSTS, requestHost } from '../lib/hostAccess';
import { MAX_BUSY_RETRIES, draft, runner, useRun, useSettings } from '../lib/makeClip';
import type { ClipType } from '../lib/types';
import { send } from '../lib/messages';
import { AiFooter, GroqBusy, GroqBusyRetried, GroqDown, MakingFailed, Offline, TooLong } from './StatesCreate';
import { GroqAccess, PenvDisconnected } from './StatesSetup';
import { RecipeThumb, TYPE_NAMES } from './Templates';

const check = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const dot = <span style={{ width: 18, height: 18, display: 'grid', placeItems: 'center' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#DCDCE0' }} /></span>;

function Step({ state, children, last, action }: { state: 'done' | 'active' | 'todo'; children: ReactNode; last?: boolean; action?: ReactNode }) {
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: last ? 0 : '1px solid #EFEFF1' }}>
      {state === 'done' ? check : state === 'active' ? <Spinner size={18} /> : dot}
      <span style={{ fontSize: 14, flexGrow: 1, fontWeight: state === 'active' ? 600 : 400, color: state === 'todo' ? 'var(--faint)' : 'inherit' }}>{children}</span>
      {action}
    </li>
  );
}

let changeRequested = false;

/** A different type on the sheet remakes a run in progress, or any run when "Change" sent you there. */
export const shouldRemake = (status: string, want: ClipType | undefined, has: ClipType | undefined, requested: boolean) =>
  !!want && want !== has && (status === 'running' || (requested && status !== 'idle'));

/** The make in progress: a preview that fills in, the steps, and the way out. */
export default function Making() {
  const { navigate, replace } = useRouter();
  const run = useRun();
  const settings = useSettings();
  const ai = run.by ?? (settings?.ai === 'local' ? 'local' : 'cloud');

  // Choosing another type on the sheet remakes the clip in it.
  useEffect(() => {
    const r = runner.get();
    const want = draft.get();
    const requested = changeRequested;
    changeRequested = false;
    if (shouldRemake(r.status, want.type, r.type, requested)) void runner.start(want, { access: 'granted' });
  }, []);

  // A finished clip is open in the editor tab; the panel goes back to Home unless there is a note to read.
  useEffect(() => {
    if (run.status === 'done' && run.notices.length === 0) { draft.clear(); runner.reset(); replace('Home'); }
  }, [run.status, run.notices, replace]);

  // Groq's limit is per minute: wait it out once, then try again.
  const waitMs = run.failure === 'groq-busy' ? (run.retryAfterMs ?? 20_000) : undefined;
  const autoRetry = run.status === 'failed' && waitMs !== undefined && run.busyRetries < MAX_BUSY_RETRIES;
  useEffect(() => {
    if (!autoRetry) return;
    const timer = setTimeout(() => { void runner.start(draft.get(), { access: 'granted', auto: true }); }, waitMs);
    return () => clearTimeout(timer);
  }, [autoRetry, waitMs]);

  const again = () => { void runner.start(draft.get(), { access: 'granted' }); };
  // Chrome only asks inside the click, so the request goes out before anything is awaited.
  const allow = () => { const access = requestHost(HOSTS.groq); void access.then((a) => runner.start(draft.get(), { access: a })); };
  const cancel = () => { void runner.cancel().then(() => replace('Home')); };
  const openNow = () => { if (run.clipId) void send({ type: 'editor/open', clipId: run.clipId }); else void runner.openNow(draft.get()); };

  const steps = run.status === 'done' ? 4 : run.steps;
  const state = (i: number) => (i < steps ? 'done' : i === steps && run.status === 'running' ? 'active' : 'todo');
  const scenes = run.recipe?.scenes.length;
  const failed = run.status === 'failed' ? run.failure : undefined;

  let card: ReactNode = null;
  if (failed === 'making-failed') card = <MakingFailed onTryAgain={again} onTemplates={() => navigate('Templates')} />;
  else if (failed === 'groq-busy' && !autoRetry) card = <GroqBusyRetried onTryNow={again} />;
  else if (failed === 'groq-busy') card = <GroqBusy seconds={Math.ceil((waitMs ?? 20_000) / 1000)} onTryNow={again} />;
  else if (failed === 'groq-down') card = <GroqDown onOpenSettings={() => navigate('Settings')} />;
  else if (failed === 'offline') card = <Offline />;
  else if (failed === 'penv-disconnected') card = <PenvDisconnected onConnect={() => navigate('PenvConnect')} />;
  else if (failed === 'groq-access') card = <GroqAccess onAllow={allow} />;
  else if (run.notices.includes('too-long')) card = <TooLong />;

  return (
    <main data-frame="Making" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '24px 24px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.02em' }}>Making your clip</h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>It opens in the editor in a few seconds.</p>
      </div>

      <div style={{ margin: '20px auto 0', width: 176, height: 312, borderRadius: 14, background: 'var(--tint-strong)', position: 'relative', overflow: 'hidden', boxShadow: '0 8px 24px rgba(16,16,20,0.08)' }}>
        {run.recipe && <RecipeThumb recipe={run.recipe} height={312} />}
        <span style={{ position: 'absolute', left: 0, bottom: 0, height: 4, width: `${(steps / 4) * 100}%`, background: 'var(--accent)', transition: 'width 300ms' }} />
      </div>

      {card && <div style={{ margin: '16px 16px 0' }}>{card}</div>}

      <ol style={{ listStyle: 'none', margin: '22px 16px 0', padding: '6px 16px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
        <Step state={state(0)} action={run.type && steps >= 1 ? <button type="button" onClick={() => { changeRequested = true; navigate('ClipType'); }} style={{ border: 0, background: 'none', padding: 0, font: '500 13px var(--font)', color: 'var(--accent)', cursor: 'pointer' }}>Change</button> : undefined}>
          Clip type{run.type && steps >= 1 ? <>: <strong style={{ fontWeight: 600 }}>{TYPE_NAMES[run.type]}</strong></> : null}
        </Step>
        <Step state={state(1)}>{scenes ? `Writing ${scenes} scene${scenes === 1 ? '' : 's'}` : 'Writing scenes'}</Step>
        <Step state={state(2)}>Choosing motion and layout</Step>
        <Step state={state(3)} last>Checking text fits and reads well</Step>
      </ol>

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button type="button" onClick={openNow} disabled={run.status === 'idle' || run.status === 'failed'} className="btn btn-secondary btn-block">Open the editor now</button>
        <button type="button" onClick={cancel} style={{ border: 0, background: 'none', font: '500 13px var(--font)', color: 'var(--accent)', cursor: 'pointer' }}>Cancel</button>
        <AiFooter ai={ai} />
      </div>
    </main>
  );
}
