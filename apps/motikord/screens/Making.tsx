import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from '../entrypoints/sidepanel/router';
import { Spinner } from '../components/ui';
import { MAX_BUSY_RETRIES, draft, lastScene, runner, useRun, useSettings } from '../lib/makeClip';
import type { ClipType, Provider } from '../lib/types';
import { PROVIDERS } from '../lib/providers';
import { send } from '../lib/messages';
import { CheckerLeftIssues, CriticNotAvailable, CriticUnreachable, MakeFooter, MakingSlow, ProviderBusy, SceneRetrying, StoryboardFailed, TooLong } from './StatesCreate';
import { getPack, getSceneTemplate } from '../lib/templates/scenes';
import { lookLine } from './LookSheet';
import { RecipeThumb } from './Templates';

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


const STEP_INDEX = { plan: 0, fill: 1, check: 2, critic: 3, open: 4 } as const;
const PROVIDER_LABEL = (by: string) => (by === 'builtin' ? 'Chrome’s built-in AI' : PROVIDERS[by as Provider].label);

/** "Scenes 1, 2 and 4" from zero-based scene indexes. */
export function sceneList(scenes: number[]): string {
  const n = scenes.map((i) => i + 1);
  if (n.length === 1) return `Scene ${n[0]}`;
  return `Scenes ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

let changeRequested = false;
/** Seconds without progress before "Still working" shows. */
const SLOW_MS = 25_000;

/** A different type on the sheet remakes a run in progress, or any run when "Change" sent you there. */
export const shouldRemake = (status: string, want: ClipType | undefined, has: ClipType | undefined, requested: boolean) =>
  !!want && want !== has && (status === 'running' || (requested && status !== 'idle'));

/** The make in progress: a preview that fills in, the steps, and the way out. */
export default function Making() {
  const { navigate, replace } = useRouter();
  const run = useRun();
  const settings = useSettings();
  const provider = settings?.provider ?? 'groq';
  const by = run.by ?? (settings?.ai === 'local' ? 'builtin' : provider);
  const [dismissed, setDismissed] = useState(false);

  // Choosing another type on the sheet remakes the clip in it.
  useEffect(() => {
    const r = runner.get();
    const want = draft.get();
    const requested = changeRequested;
    changeRequested = false;
    if (shouldRemake(r.status, want.type, r.type, requested)) void runner.start(want, { access: 'granted' });
  }, []);

  const staysForCards = run.notices.length > 0 || run.issuesLeft.length > 0 || run.criticSkipped === 'critic-not-available' || (run.criticSkipped === 'critic-unreachable' && !dismissed);
  // A finished clip is open in the editor tab; the panel goes back to Home unless there is a note to read.
  useEffect(() => {
    if (run.status === 'done' && !staysForCards) { draft.clear(); runner.reset(); replace('Home'); }
  }, [run.status, staysForCards, replace]);

  // "Still working" shows when a step has not moved for a while.
  const progress = `${run.step}/${run.filled}/${run.filling}/${run.retrying}/${run.fixes.length}`;
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (run.status !== 'running' || run.paused) return;
    const timer = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(timer);
  }, [progress, run.status, run.paused]);

  // Providers limit per minute: wait it out once, then try again.
  const waitMs = run.failure === 'provider-busy' ? (run.retryAfterMs ?? 20_000) : undefined;
  const autoRetry = run.status === 'failed' && waitMs !== undefined && run.busyRetries < MAX_BUSY_RETRIES;
  useEffect(() => {
    if (!autoRetry) return;
    const timer = setTimeout(() => { void runner.start(draft.get(), { access: 'granted', auto: true }); }, waitMs);
    return () => clearTimeout(timer);
  }, [autoRetry, waitMs]);

  const again = () => { void runner.start(draft.get(), { access: 'granted' }); };
  const cancel = () => { void runner.cancel().then(() => replace('Home')); };
  const openNow = () => { if (run.clipId) void send({ type: 'editor/open', clipId: run.clipId }); else void runner.openNow(draft.get()); };

  const failed = run.status === 'failed' ? run.failure : undefined;
  // Every failure except a busy provider being waited out, or a story that would not plan, shows the whole MakingFailed screen.
  const failedForGood = !!failed && !autoRetry && failed !== 'storyboard-failed';
  useEffect(() => { if (failedForGood) replace('MakingFailed'); }, [failedForGood, replace]);

  const done = run.status === 'done';
  const at = done ? 5 : STEP_INDEX[run.step ?? 'plan'];
  const state = (i: number) => (i < at ? 'done' : i === at && run.status === 'running' ? 'active' : 'todo');
  const sb = run.storyboard;
  const pack = sb ? getPack(sb.style) : undefined;
  const lengthS = sb ? Math.round(sb.beats.reduce((t, b) => t + b.ms, 0) / 1000) : 0;
  const n = (run.filling ?? run.filled) + 1;
  const beat = sb?.beats[Math.min(n - 1, (sb?.beats.length ?? 1) - 1)];
  const sceneName = beat ? getSceneTemplate(beat.template)?.name : undefined;
  const criticSteps = run.criticSkipped !== 'critic-off' && run.criticSkipped !== 'critic-not-available';
  const criticRan = !!run.critic && run.criticSkipped !== 'critic-unreachable' && at >= 4;

  let card: ReactNode = null;
  if (failed === 'storyboard-failed') card = <StoryboardFailed provider={provider} onTryAgain={again} onSimpler={() => { void runner.cancel().then(() => replace('Home')); }} />;
  else if (failed === 'provider-busy' && autoRetry) card = <ProviderBusy provider={provider} seconds={Math.ceil((waitMs ?? 20_000) / 1000)} onTryNow={again} />;
  else if (run.notices.includes('too-long')) card = <TooLong />;
  else if (run.retrying !== undefined && run.status === 'running') card = <SceneRetrying n={run.retrying + 1} />;
  else if (slow) card = <MakingSlow provider={provider === 'groq' || by === 'builtin' ? provider : by} />;
  else if (run.criticSkipped === 'critic-not-available') card = <CriticNotAvailable model={run.criticModel} onChangeModel={() => navigate('SettingsModel')} />;
  else if (run.criticSkipped === 'critic-unreachable' && !dismissed) card = <CriticUnreachable provider={provider} onDismiss={() => setDismissed(true)} />;
  else if (run.issuesLeft.length > 0 && done) card = <CheckerLeftIssues n={run.issuesLeft.length} onOpen={() => { if (run.clipId) void send({ type: 'editor/open', clipId: run.clipId }); }} />;

  return (
    <main data-frame={run.fixes.length > 0 || run.critic ? 'MakingCheck' : 'MakingStoryboard'} style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '24px 24px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.02em' }}>Making your clip</h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>It opens in the editor in a few seconds.</p>
        {run.look && <span style={{ alignSelf: 'flex-start', marginTop: 4, height: 26, padding: '0 10px', borderRadius: 999, background: 'var(--tint-strong)', color: 'var(--accent-hover)', font: '500 12px/26px var(--font)' }}>{lookLine(run.look)}</span>}
      </div>

      <div style={{ margin: '20px auto 0', width: 176, height: 312, borderRadius: 14, background: pack ? `linear-gradient(160deg, ${pack.palette.bg}, ${pack.palette.bg2})` : 'var(--tint-strong)', position: 'relative', overflow: 'hidden', boxShadow: '0 8px 24px rgba(16,16,20,0.08)' }}>
        {run.recipe && <RecipeThumb recipe={run.recipe} height={312} />}
        {!run.recipe && beat && sceneName && at === 1 && <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 16, textAlign: 'center', font: `600 16px/1.2 '${pack?.fonts.display ?? 'inherit'}', var(--font)`, color: pack?.palette.ink }}>{beat.line}</span>}
        {at === 1 && beat && sceneName && <span style={{ position: 'absolute', left: 8, top: 8, padding: '3px 8px', borderRadius: 999, background: 'rgba(17,17,20,0.65)', color: '#fff', font: '500 11px var(--font)' }}>{`Scene ${n} · ${sceneName}`}</span>}
        <span style={{ position: 'absolute', left: 0, bottom: 0, height: 4, width: `${(Math.min(at, 5) / 5) * 100}%`, background: 'var(--accent)', transition: 'width 300ms' }} />
      </div>

      {card && <div style={{ margin: '16px 16px 0' }}>{card}</div>}

      <ol style={{ listStyle: 'none', margin: '22px 16px 0', padding: '6px 16px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
        <Step state={state(0)} last={false}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            Planning the story
            {sb && (
              <>
                <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>{`${sb.beats.length} scenes · ${lengthS} s · ${pack?.name ?? sb.style}`}</span>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {sb.beats.map((b, i) => (
                    <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, fontWeight: 400 }}>
                      <span style={{ fontWeight: 600, flexShrink: 0 }}>{getSceneTemplate(b.template)?.name ?? b.template}</span>
                      <span style={{ flexGrow: 1, minWidth: 0, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.line}</span>
                      <span className="mono" style={{ flexShrink: 0, color: 'var(--faint)' }}>{`${+(b.ms / 1000).toFixed(1)} s`}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </span>
        </Step>
        <Step state={state(1)}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {at > 1 ? `Filling ${run.total} scenes` : run.total > 0 ? `Filling scene ${Math.min(n, run.total)} of ${run.total}` : 'Filling scenes'}
            {at === 1 && run.total > 0 && <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>{`${run.filled} of ${run.total} done`}</span>}
          </span>
        </Step>
        <Step state={state(2)} last={false}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            Checking the layout
            {run.fixes.length > 0 && (
              <>
                <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>{`Fixed ${run.fixes.length} ${run.fixes.length === 1 ? 'thing' : 'things'}`}</span>
                {run.fixes.map((f) => <span key={f} style={{ fontSize: 12, fontWeight: 400 }}>{f}</span>)}
              </>
            )}
          </span>
        </Step>
        {criticSteps && (
          <Step state={state(3)}>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              Looking at a few frames
              {run.critic && <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>{`${PROVIDER_LABEL(by)} is looking at ${run.critic.frames} small frames`}</span>}
              {run.critic && <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>{sceneList(run.critic.scenes)}</span>}
            </span>
          </Step>
        )}
        <Step state={state(4)} last>Opening the editor</Step>
      </ol>

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {run.status === 'running' && !run.paused && <button type="button" onClick={() => { if (runner.pause()) navigate('StoryboardEdit'); }} disabled={(run.pausing && !run.paused) || lastScene(run.filling, run.total)} className="btn btn-secondary btn-block">Pause and check the plan</button>}
        <button type="button" onClick={openNow} disabled={run.status === 'idle' || run.status === 'failed'} className="btn btn-secondary btn-block">Open the editor now</button>
        <button type="button" onClick={cancel} style={{ border: 0, background: 'none', font: '500 13px var(--font)', color: 'var(--accent)', cursor: 'pointer' }}>Cancel</button>
        <MakeFooter by={by} frames={criticRan ? run.critic?.frames : undefined} />
      </div>
    </main>
  );
}
