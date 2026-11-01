import { useEffect, useRef, useState } from 'react';
import { Spinner } from '../components/ui';
import { useRouter } from '../entrypoints/sidepanel/router';
import { LINE_WORDS } from '../lib/ai/storyboard';
import { runner, useRun, useSettings } from '../lib/makeClip';
import { getPack, getSceneTemplate, SCENE_TEMPLATES } from '../lib/templates/scenes';
import type { Beat, Storyboard } from '../lib/types';
import { PROVIDERS } from '../lib/providers';
import { MakeFooter } from './StatesCreate';

const STEP_MS = 500;
const MIN_MS = 1000;
const MAX_MS = 10_000;

export const wordCount = (line: string) => line.trim().split(/\s+/).filter(Boolean).length;
export const totalSeconds = (beats: Beat[]) => Math.round(beats.reduce((t, b) => t + b.ms, 0) / 1000);
export function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = list.slice();
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}
export const stepMs = (ms: number, by: 1 | -1) => Math.max(MIN_MS, Math.min(MAX_MS, ms + by * STEP_MS));

const icon = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
const small = { width: 32, height: 32, border: 0, borderRadius: 8, background: 'transparent', color: 'var(--muted)', display: 'grid', placeItems: 'center', cursor: 'pointer', padding: 0 } as const;

/** Check the plan: edit the beats the run is paused on, then make the scenes. */
export default function StoryboardEdit() {
  const { navigate, replace } = useRouter();
  const run = useRun();
  const settings = useSettings();
  const by = run.by ?? (settings?.ai === 'local' ? 'builtin' : settings?.provider ?? 'groq');
  const [beats, setBeats] = useState<Beat[]>([]);
  const drag = useRef<number | undefined>(undefined);
  const plan = run.paused ? run.storyboard : undefined;

  useEffect(() => { if (plan) setBeats(plan.beats); }, [plan]);
  useEffect(() => { if (run.status === 'idle') replace('Home'); }, [run.status, replace]);
  // The run went on without this screen (it finished, or failed): back to Making.
  useEffect(() => { if (run.status === 'done' || run.status === 'failed') replace('Making'); }, [run.status, replace]);

  const edit = (i: number, patch: Partial<Beat>) => setBeats((all) => all.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const style = plan ? getPack(plan.style)?.name ?? plan.style : '';
  const make = () => {
    if (!plan) return;
    const next: Storyboard = { ...plan, beats };
    runner.resume(next);
    navigate('Making');
  };

  return (
    <main data-frame="StoryboardEdit" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '24px 24px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.02em' }}>Check the plan</h1>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>{`This is the story ${by === 'builtin' ? 'Chrome’s built-in AI' : PROVIDERS[by].label} planned. Change anything, then make the scenes.`}</p>
      </div>

      {!plan ? (
        <div style={{ display: 'grid', placeItems: 'center', padding: 40 }}><Spinner size={22} /></div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 24px 0' }}>
            <span style={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>{`${beats.length} scenes · ${totalSeconds(beats)} s`}</span>
            <button type="button" onClick={() => navigate('LookSheet')} style={{ height: 28, padding: '0 10px', borderRadius: 999, border: '1px solid #E0E0E4', background: 'var(--surface)', font: '500 12px var(--font)', color: 'var(--ink)', cursor: 'pointer' }}>{style}</button>
          </div>
          <ol style={{ listStyle: 'none', margin: 0, padding: '10px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {beats.map((b, i) => {
              const words = wordCount(b.line);
              return (
                <li key={i} onDragOver={(e) => e.preventDefault()} onDrop={() => { if (drag.current !== undefined) setBeats((all) => move(all, drag.current!, i)); drag.current = undefined; }}
                  style={{ padding: 12, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button type="button" aria-label="Drag to reorder" draggable onDragStart={() => { drag.current = i; }}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowUp') { e.preventDefault(); setBeats((all) => move(all, i, i - 1)); }
                        if (e.key === 'ArrowDown') { e.preventDefault(); setBeats((all) => move(all, i, i + 1)); }
                      }} style={{ ...small, cursor: 'grab' }}>
                      <svg {...icon}><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" /></svg>
                    </button>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--faint)', width: 14 }}>{i + 1}</span>
                    <select aria-label="Template" value={b.template} onChange={(e) => edit(i, { template: e.target.value as Beat['template'] })}
                      style={{ flexGrow: 1, minWidth: 0, height: 32, border: '1px solid #E0E0E4', borderRadius: 8, background: 'var(--surface)', font: '600 13px var(--font)', color: 'var(--ink)', padding: '0 6px' }}>
                      {SCENE_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <button type="button" aria-label="Remove scene" disabled={beats.length <= 1} onClick={() => setBeats((all) => all.filter((_, j) => j !== i))} style={small}>
                      <svg {...icon}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg>
                    </button>
                  </div>
                  <textarea aria-label={`Scene ${i + 1} line`} rows={2} value={b.line} onChange={(e) => edit(i, { line: e.target.value })}
                    style={{ resize: 'none', border: '1px solid #E0E0E4', borderRadius: 10, padding: '8px 10px', font: '13px/1.4 var(--font)', color: 'var(--ink)', outline: 'none' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, flexGrow: 1, color: words > LINE_WORDS ? 'var(--error-ink, #B91C1C)' : 'var(--muted)' }}>{`${words} of ${LINE_WORDS} words`}</span>
                    <button type="button" aria-label="Shorter" onClick={() => edit(i, { ms: stepMs(b.ms, -1) })} style={small}>−</button>
                    <span className="mono" style={{ fontSize: 12, minWidth: 34, textAlign: 'center' }}>{`${+(b.ms / 1000).toFixed(1)} s`}</span>
                    <button type="button" aria-label="Longer" onClick={() => edit(i, { ms: stepMs(b.ms, 1) })} style={small}>+</button>
                  </div>
                </li>
              );
            })}
          </ol>
          <div style={{ padding: '10px 16px 0' }}>
            <button type="button" className="btn btn-secondary btn-block"
              onClick={() => setBeats((all) => [...all, { template: 'big-statement', line: '', ms: getSceneTemplate('big-statement')?.defaultMs ?? 3000 }])}>Add a scene</button>
          </div>
        </>
      )}

      <div style={{ flexGrow: 1 }} />
      <div style={{ padding: '16px 16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button type="button" onClick={make} disabled={!plan || beats.length === 0} className="btn btn-primary btn-block">Make these scenes</button>
        <button type="button" onClick={() => runner.replan()} disabled={!plan} className="btn btn-secondary btn-block">Plan it again</button>
        <button type="button" onClick={() => { void runner.cancel().then(() => replace('Home')); }} style={{ border: 0, background: 'none', font: '500 13px var(--font)', color: 'var(--accent)', cursor: 'pointer' }}>Cancel</button>
        <MakeFooter by={by} />
      </div>
    </main>
  );
}
