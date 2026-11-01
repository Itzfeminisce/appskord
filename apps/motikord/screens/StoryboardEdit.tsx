import { useEffect, useRef, useState } from 'react';
import { Spinner } from '../components/ui';
import { useRouter } from '../entrypoints/sidepanel/router';
import { LINE_WORDS } from '../lib/ai/storyboard';
import { runner, useDraft, useRun, useSettings } from '../lib/makeClip';
import { autoStyle, getPack, getSceneTemplate, SCENE_TEMPLATES } from '../lib/templates/scenes';
import type { Beat, Storyboard } from '../lib/types';
import { PROVIDERS } from '../lib/providers';
import { MakeFooter } from './StatesCreate';
import { PackSwatch } from './makeParts';

const STEP_MS = 500;
const MIN_MS = 1000;
const MAX_MS = 10_000;

export const wordCount = (line: string) => line.trim().split(/\s+/).filter(Boolean).length;
/** Blank lines are dropped when the plan is cleaned, so at least one scene must have words. */
export const hasLine = (beats: Beat[]) => beats.some((b) => b.line.trim() !== '');
export const totalSeconds = (beats: Beat[]) => Math.round(beats.reduce((t, b) => t + b.ms, 0) / 1000);
export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
export const stepMs = (ms: number, by: 1 | -1) => Math.max(MIN_MS, Math.min(MAX_MS, ms + by * STEP_MS));

const icon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const small = { width: 28, height: 28, border: 0, borderRadius: 8, background: 'transparent', color: 'var(--faint)', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 } as const;
const stepBtn = { width: 26, height: 26, border: 0, background: 'none', color: 'var(--muted)', fontSize: 15, padding: 0, cursor: 'pointer' } as const;
const chevron = <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>;

/** Check the plan: edit the beats the run is paused on, then make the scenes. */
export default function StoryboardEdit() {
  const { navigate, replace } = useRouter();
  const run = useRun();
  const settings = useSettings();
  const d = useDraft();
  const by = run.by ?? (settings?.ai === 'local' ? 'builtin' : settings?.provider ?? 'groq');
  const [beats, setBeats] = useState<Beat[]>([]);
  const drag = useRef<number | undefined>(undefined);
  const plan = run.paused ? run.storyboard : undefined;

  useEffect(() => { if (plan) setBeats(plan.beats); }, [plan]);
  useEffect(() => { if (run.status === 'idle') replace('Home'); }, [run.status, replace]);
  // The run went on without this screen (it finished, or failed): back to Making.
  useEffect(() => { if (run.status === 'done' || run.status === 'failed') replace('Making'); }, [run.status, replace]);

  const edit = (i: number, patch: Partial<Beat>) => setBeats((all) => all.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  // The chip shows the look a change in LookSheet set, which the next plan or the scenes will use.
  const chosen = d.look?.style ?? settings?.look.style;
  const styleId = plan ? (chosen ? (chosen === 'auto' ? autoStyle(run.type ?? 'social') : chosen) : plan.style) : undefined;
  const style = styleId ? getPack(styleId)?.name ?? styleId : '';
  const canMake = hasLine(beats);
  const make = () => {
    if (!plan) return;
    const next: Storyboard = { ...plan, beats };
    runner.resume(next);
    navigate('Making');
  };

  return (
    <main data-frame="StoryboardEdit" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '20px 16px 0 18px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.02em' }}>Check the plan</h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>{`This is the story ${by === 'builtin' ? 'Chrome’s built-in AI' : PROVIDERS[by].label} planned. Change anything, then make the scenes.`}</p>
      </div>

      {!plan ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: 40 }}><Spinner size={22} /></div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 16px 0 18px' }}>
            <span style={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>{`${beats.length} scenes · ${totalSeconds(beats)} s · ${style}`}</span>
            <button type="button" aria-label={`Style: ${style}. Change the look`} onClick={() => navigate('LookSheet')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 32, padding: '0 10px 0 6px', borderRadius: 999, border: '1px solid var(--line)', background: 'var(--surface)', font: '500 13px var(--font)', color: 'var(--ink)', cursor: 'pointer' }}>
              <PackSwatch style={styleId} />{style}<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
          </div>
          <ol style={{ listStyle: 'none', margin: '10px 16px 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {beats.map((b, i) => {
              const words = wordCount(b.line);
              const name = getSceneTemplate(b.template)?.name ?? b.template;
              return (
                <li key={i} className="beat-card" onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag.current !== undefined) setBeats((all) => move(all, drag.current!, i)); drag.current = undefined; }}
                  style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: '8px 12px 8px 6px', display: 'grid', gridTemplateColumns: '26px 1fr', columnGap: 4, rowGap: 6 }}>
                  <button type="button" aria-label="Drag to reorder" draggable onDragStart={() => { drag.current = i; }}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowUp') { e.preventDefault(); setBeats((all) => move(all, i, i - 1)); }
                      if (e.key === 'ArrowDown') { e.preventDefault(); setBeats((all) => move(all, i, i + 1)); }
                    }} style={{ gridRow: 'span 2', width: 26, height: 32, border: 0, background: 'none', padding: 0, display: 'grid', placeItems: 'center', cursor: 'grab', color: '#A1A3AA' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{[6, 12, 18].flatMap((y) => [9, 15].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" />))}</svg>
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--faint)', width: 12 }}>{i + 1}</span>
                    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 8px 0 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'var(--fill)', fontSize: 12, fontWeight: 600 }}>
                      {name}{chevron}
                      <select aria-label={`Template: ${name}. Change template`} value={b.template} onChange={(e) => edit(i, { template: e.target.value as Beat['template'] })}
                        style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', font: '600 13px var(--font)' }}>
                        {SCENE_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    </span>
                    <span style={{ flexGrow: 1 }} />
                    <div role="group" aria-label={`Scene ${i + 1} length`} style={{ display: 'inline-flex', alignItems: 'center', height: 28, borderRadius: 8, border: '1px solid var(--line)' }}>
                      <button type="button" aria-label="Shorter" onClick={() => edit(i, { ms: stepMs(b.ms, -1) })} style={stepBtn}>−</button>
                      <span className="mono" style={{ fontSize: 12, minWidth: 26, textAlign: 'center' }}>{`${+(b.ms / 1000).toFixed(1)} s`}</span>
                      <button type="button" aria-label="Longer" onClick={() => edit(i, { ms: stepMs(b.ms, 1) })} style={stepBtn}>+</button>
                    </div>
                    <button type="button" aria-label="Remove scene" disabled={beats.length <= 1} onClick={() => setBeats((all) => all.filter((_, j) => j !== i))} style={small}>
                      <svg {...icon}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 20 }}>
                    <input type="text" aria-label={`Scene ${i + 1} line`} value={b.line} onChange={(e) => edit(i, { line: e.target.value })}
                      style={{ height: 36, border: '1px solid var(--line)', borderRadius: 10, width: '100%', padding: '0 10px', font: '14px var(--font)', color: 'var(--ink)', background: 'var(--surface)', outline: 'none' }} />
                    <span style={{ fontSize: 12, lineHeight: '16px', textAlign: 'right', color: words > LINE_WORDS ? 'var(--error-ink)' : 'var(--faint)' }}>{`${words} of ${LINE_WORDS} words`}</span>
                  </div>
                </li>
              );
            })}
          </ol>
          <button type="button" onClick={() => setBeats((all) => [...all, { template: 'big-statement', line: '', ms: getSceneTemplate('big-statement')?.defaultMs ?? 3000 }])}
            style={{ margin: '8px 16px 0', height: 44, borderRadius: 12, border: '1.5px dashed var(--line-strong)', background: 'transparent', color: 'var(--muted)', font: '500 14px var(--font)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }}>
            <svg {...icon}><path d="M12 5v14M5 12h14" /></svg>Add a scene
          </button>
        </>
      )}

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button type="button" onClick={make} disabled={!plan || !canMake} className="btn btn-primary btn-block btn-tall">Make these scenes</button>
        <button type="button" onClick={() => runner.replan()} disabled={!plan} className="btn btn-secondary btn-block btn-tall" style={{ borderColor: 'var(--line)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg>Plan it again
        </button>
        <button type="button" onClick={() => { void runner.cancel().then(() => replace('Home')); }} style={{ alignSelf: 'center', padding: '6px 12px', border: 0, background: 'none', font: '14px var(--font)', color: 'var(--accent)', cursor: 'pointer' }}>Cancel</button>
        <MakeFooter by={by} />
      </div>
    </main>
  );
}
