import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from '../entrypoints/sidepanel/router';
import { MAX_BUSY_RETRIES, draft, lastScene, runner, useRun, useSettings } from '../lib/makeClip';
import type { ClipType, Provider, StyleId } from '../lib/types';
import { PROVIDERS } from '../lib/providers';
import { send } from '../lib/messages';
import { CheckerLeftIssues, CriticNotAvailable, CriticUnreachable, MakeFooter, MakingSlow, ProviderBusy, SceneRetrying, StoryboardFailed, TooLong } from './StatesCreate';
import { getPack, getSceneTemplate } from '../lib/templates/scenes';
import { lookLine } from './LookSheet';
import { beatPreview, PackSwatch, SceneThumb } from './makeParts';

const check = (size = 18) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="var(--success-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const spinner = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0, animation: 'spin 0.9s linear infinite' }}><path d="M12 3a9 9 0 1 0 9 9" /></svg>;
const dot = <span style={{ width: 18, height: 18, display: 'grid', placeItems: 'center', flexShrink: 0 }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: '#DCDCE0' }} /></span>;
const fixIcon = (line: string) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--success-ink)" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }}><path d={/ swapped /.test(line) ? 'M4 8h13l-3-3M20 16H7l3 3' : 'M4 7h16M7 12h10M10 17h4'} /></svg>;
const inset = { marginLeft: 30, borderRadius: 12, background: 'var(--fill)', border: '1px solid var(--line-soft)' } as const;

type StepState = 'done' | 'active' | 'todo';
/** One step row; `detail` sits under it, indented past the icon. */
function Step({ state, label, side, detail, last }: { state: StepState; label: ReactNode; side?: ReactNode; detail?: ReactNode; last?: boolean }) {
  return (
    <li aria-current={state === 'active' ? 'step' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: detail ? '12px 0 14px' : '12px 0', borderBottom: last ? 0 : '1px solid var(--line-soft)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {state === 'done' ? check() : state === 'active' ? spinner : dot}
        <span style={{ fontSize: 14, lineHeight: 1.25, flexGrow: 1, fontWeight: state === 'active' ? 600 : 400, color: state === 'todo' ? 'var(--faint)' : 'inherit' }}>{label}</span>
        {side && <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{side}</span>}
      </div>
      {detail}
    </li>
  );
}

/** "Scene 2 headline cut to 6 words" with the scene in bold. */
function FixLine({ line }: { line: string }) {
  const m = /^(Scenes? [\d, and]+?)( .*)$/.exec(line);
  return (
    <li style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      {fixIcon(line)}
      <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>{m ? <><strong style={{ fontWeight: 600, color: 'var(--ink)' }}>{m[1]}</strong>{m[2]}</> : line}</span>
    </li>
  );
}

const STEP_INDEX = { plan: 0, fill: 1, check: 2, critic: 3, open: 4 } as const;
const tile = (selected: boolean) => ({ width: 44, height: 78, borderRadius: 6, ...(selected ? { outline: '2px solid var(--accent)', outlineOffset: 2 } : {}) });
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
  const state = (i: number): StepState => (i < at ? 'done' : i === at && run.status === 'running' ? 'active' : 'todo');
  const sb = run.storyboard;
  const pack = sb ? getPack(sb.style) : undefined;
  const lengthS = sb ? Math.round(sb.beats.reduce((t, b) => t + b.ms, 0) / 1000) : 0;
  const n = (run.filling ?? run.filled) + 1;
  const total = run.total || sb?.beats.length || 0;
  const criticSteps = run.criticSkipped !== 'critic-off' && run.criticSkipped !== 'critic-not-available';
  const criticRan = !!run.critic && run.criticSkipped !== 'critic-unreachable' && at >= 4;
  const templateName = (id: string) => getSceneTemplate(id)?.name ?? id;
  // The preview: the scene being filled from its planned line, then the made clip's latest scene looked at.
  const shownIndex = run.recipe ? (run.critic?.scenes.at(-1) ?? run.recipe.scenes.length - 1) : at === 1 ? Math.min(n, total) - 1 : -1;
  const preview = run.recipe ?? (sb && shownIndex >= 0 && sb.beats[shownIndex] ? beatPreview(sb.beats[shownIndex], sb.style, draft.get().aspect ?? '9:16', sb.name) : undefined);
  const previewIndex = run.recipe ? shownIndex : 0;
  const shownTemplate = run.recipe?.scenes[shownIndex]?.template ?? (shownIndex >= 0 ? sb?.beats[shownIndex]?.template : undefined);
  const caption = shownIndex >= 0 && shownTemplate ? `Scene ${shownIndex + 1} · ${templateName(shownTemplate)}` : undefined;

  let card: ReactNode = null;
  if (failed === 'storyboard-failed') card = <StoryboardFailed provider={provider} onTryAgain={again} onSimpler={() => { void runner.cancel().then(() => replace('Home')); }} />;
  else if (failed === 'provider-busy' && autoRetry) card = <ProviderBusy provider={provider} seconds={Math.ceil((waitMs ?? 20_000) / 1000)} onTryNow={again} />;
  else if (run.notices.includes('too-long')) card = <TooLong />;
  else if (run.retrying !== undefined && run.status === 'running') card = <SceneRetrying n={run.retrying + 1} />;
  else if (slow) card = <MakingSlow provider={provider === 'groq' || by === 'builtin' ? provider : by} />;
  else if (run.criticSkipped === 'critic-not-available') card = <CriticNotAvailable model={run.criticModel} onChangeModel={() => navigate('SettingsModel')} />;
  else if (run.criticSkipped === 'critic-unreachable' && !dismissed) card = <CriticUnreachable provider={provider} onDismiss={() => setDismissed(true)} />;
  else if (run.issuesLeft.length > 0 && done) card = <CheckerLeftIssues n={run.issuesLeft.length} onOpen={() => { if (run.clipId) void send({ type: 'editor/open', clipId: run.clipId }); }} />;

  const planCard = sb && (
    <div style={{ ...inset, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderBottom: '1px solid var(--line-soft)' }}>
        <span style={{ fontSize: 12, fontWeight: 600, flexGrow: 1 }}>{`${sb.beats.length} scenes · ${lengthS} s · ${pack?.name ?? sb.style}`}</span>
        <PackSwatch style={sb.style} w={10} h={16} radius={2} />
      </div>
      <ol style={{ listStyle: 'none', margin: 0, padding: '4px 0' }}>
        {sb.beats.map((b, i) => {
          const now = at === 1 && i === n - 1;
          const filled = at > 1 || i < run.filled;
          return (
            <li key={i} aria-current={now ? 'step' : undefined} style={{ display: 'grid', gridTemplateColumns: '20px 1fr auto', columnGap: 8, alignItems: 'baseline', padding: '6px 12px', ...(now ? { background: 'var(--tint)', boxShadow: 'inset 2px 0 0 var(--accent)' } : {}) }}>
              <span className="mono" style={{ fontSize: 12, color: now ? 'var(--accent-hover)' : 'var(--faint)', fontWeight: now ? 500 : 400, alignSelf: 'start', paddingTop: 1 }}>{filled && !now ? check(14) : i + 1}</span>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0, lineHeight: 1.25 }}>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{templateName(b.template)}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{b.line}</span>
              </span>
              <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: now ? 'var(--accent-hover)' : 'var(--muted)', fontWeight: now ? 600 : 400 }}>{`${+(b.ms / 1000).toFixed(1)} s`}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );

  return (
    <main data-frame={run.fixes.length > 0 || run.critic ? 'MakingCheck' : 'MakingStoryboard'} style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '24px 24px 0', display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexGrow: 1, paddingTop: 8 }}>
          <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.02em' }}>Making your clip</h1>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>It opens in the editor in a few seconds.</p>
          {run.look && (
            <span style={{ marginTop: 8, alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px 0 6px', borderRadius: 999, background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 12, fontWeight: 500 }}>
              <PackSwatch style={sb?.style ?? (run.look.style as StyleId)} w={12} h={18} radius={2} />
              {lookLine(run.look)}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <div role="img" aria-label={caption ? `${caption} preview` : 'Preview'} style={{ width: 96, height: 170, borderRadius: 10, background: pack?.palette.bg ?? 'var(--tint-strong)', position: 'relative', overflow: 'hidden', boxShadow: '0 10px 28px -6px rgba(16,16,20,0.28), 0 0 0 1px rgba(16,16,20,0.06)' }}>
            {preview && <SceneThumb recipe={preview} index={previewIndex} width={96} height={170} />}
            {at === 1 && total > 0 && <span style={{ position: 'absolute', left: 0, bottom: 0, height: 3, width: `${(run.filled / total) * 100}%`, background: pack?.palette.accent ?? 'var(--accent)', transition: 'width 300ms' }} />}
          </div>
          {caption && <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{caption}</span>}
        </div>
      </div>

      {card && <div style={{ margin: '16px 16px 0' }}>{card}</div>}

      <ol style={{ listStyle: 'none', margin: '20px 16px 0', padding: '6px 16px', borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column' }}>
        <Step state={state(0)} label="Planning the story"
          side={sb && at > 1 ? `${sb.beats.length} scenes · ${lengthS} s · ${pack?.name ?? sb.style}` : undefined}
          detail={at === 1 ? planCard : undefined} />
        <Step state={state(1)}
          label={at > 1 ? `Filling ${total} scenes` : total > 0 ? `Filling scene ${Math.min(n, total)} of ${total}` : 'Filling scenes'}
          side={at === 1 && total > 0 ? `${run.filled} of ${total} done` : undefined}
          detail={at === 1 && total > 0 ? (
            <div role="progressbar" aria-label="Filling scenes" aria-valuemin={0} aria-valuemax={total} aria-valuenow={run.filled} style={{ marginLeft: 30, height: 3, borderRadius: 2, background: '#F1F1F3', overflow: 'hidden' }}>
              <span style={{ display: 'block', width: `${((run.filled + 0.5) / total) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 2, transition: 'width 300ms' }} />
            </div>
          ) : undefined} />
        <Step state={state(2)} label="Checking the layout"
          detail={run.fixes.length > 0 ? (
            <div style={{ ...inset, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{`Fixed ${run.fixes.length} ${run.fixes.length === 1 ? 'thing' : 'things'}`}</span>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {run.fixes.map((f) => <FixLine key={f} line={f} />)}
              </ul>
            </div>
          ) : undefined} />
        {criticSteps && (
          <Step state={state(3)} label="Looking at a few frames"
            detail={run.critic ? (
              <div style={{ marginLeft: 30, display: 'flex', alignItems: 'center', gap: 10 }}>
                {run.recipe && run.critic.scenes.map((i, k) => {
                  const last = k === run.critic!.scenes.length - 1 && at === 3;
                  return (
                    <span key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <SceneThumb recipe={run.recipe!} index={i} width={44} height={78} style={tile(last)} />
                      <span className="mono" style={{ fontSize: 10, color: last ? 'var(--accent-hover)' : 'var(--muted)', textAlign: 'center' }}>{i + 1}</span>
                    </span>
                  );
                })}
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>
                  {`${PROVIDER_LABEL(by)} is looking at ${run.critic.frames} small frames`}
                  <span className="mono" style={{ fontSize: 11 }}>{sceneList(run.critic.scenes)}</span>
                </span>
              </div>
            ) : undefined} />
        )}
        <Step state={state(4)} label="Opening the editor" last />
      </ol>

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {run.status === 'running' && !run.paused && at <= 1 && (
          <button type="button" onClick={() => { if (runner.pause()) navigate('StoryboardEdit'); }} disabled={(run.pausing && !run.paused) || lastScene(run.filling, run.total)} className="btn btn-tint btn-block btn-tall">Pause and check the plan</button>
        )}
        <button type="button" onClick={openNow} disabled={run.status === 'idle' || run.status === 'failed'} className="btn btn-secondary btn-block btn-tall">Open the editor now</button>
        <button type="button" onClick={cancel} style={{ height: 40, border: 0, background: 'none', font: '500 14px var(--font)', color: 'var(--accent)', cursor: 'pointer' }}>Cancel</button>
        <MakeFooter by={by} frames={criticRan || (at === 3 && run.critic) ? run.critic?.frames : undefined} />
      </div>
    </main>
  );
}
