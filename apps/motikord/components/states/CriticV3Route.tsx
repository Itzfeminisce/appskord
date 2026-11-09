import { useEffect, useRef, useState } from 'react';
import type { LookGuide } from '@appskord/motion/types';
import { useRouter } from '../../entrypoints/editor/router';
import { criticModel } from '../../lib/ai/critic';
import { applyFix, QUALITY, qualityCheck, type QualityNote, type QualityResult } from '../../lib/critic/v3';
import { getClip, putClip } from '../../lib/db';
import { HOSTS, requestHost } from '../../lib/hostAccess';
import { PROVIDERS } from '../../lib/providers';
import { isRestyled, type RestyledClip } from '../../lib/restyle/restyle';
import { getSettings } from '../../lib/settings';
import { goInSidePanel, useWindowId } from '../../lib/sidepanelGo';
import type { Settings } from '../../lib/types';
import { clipLook } from '../../lib/v3/look';
import { sceneLayerText } from '../../lib/v3/text';
import { ClipNotFound } from '../../screens/editor/StatesEditor';
import { applyOps, initV3 } from '../editor/model';
import CriticV3 from './CriticV3';

// The editor's Check for a v3 clip: a live run of the three-pass quality check on frames V3Renderer draws.

export interface CriticDeps {
  check(clip: RestyledClip, look: LookGuide, signal: AbortSignal, fixesUsed?: Record<string, number>): Promise<QualityResult>;
  save(clip: RestyledClip): Promise<unknown>;
}

const liveDeps: CriticDeps = {
  async check(clip, look, signal, fixesUsed) {
    const settings = await getSettings();
    const critic = await criticModel(settings, { signal });
    // three.js loads only now, when frames are drawn.
    const { clipFramesFor } = await import('../../lib/v3/frames');
    const render = clipFramesFor((i, l) => sceneLayerText(clip.recipe.scenes[i], l), look);
    return qualityCheck({ recipe: clip.recipe, clip: clip.v3, look }, { critic, signal, render, fixesUsed });
  },
  save: putClip,
};

/** The fixes as one Change by 'check', so Changes can take them back. */
export function withFixes(clip: RestyledClip, next: Pick<QualityResult, 'recipe' | 'clip'>, summary: string): RestyledClip {
  return applyOps(initV3(clip), [{ op: 'replace', path: '/recipe', value: next.recipe }, { op: 'replace', path: '/v3', value: next.clip }], { summary, by: 'check' }).clip;
}

export function CriticV3Live({ clip: first, look, provider, deps = liveDeps, onShow, onPasteKey, onChangeModel, onAsk }: {
  clip: RestyledClip; look: LookGuide; provider: string; deps?: CriticDeps;
  onShow?: (n: QualityNote) => void; onPasteKey?: () => void; onChangeModel?: () => void;
  /** Called inside the click before a re-run, for the AI host's access. */
  onAsk?: () => Promise<unknown> | void;
}) {
  const [clip, setClip] = useState(first);
  const [result, setResult] = useState<QualityResult>();
  const ctl = useRef<AbortController>(undefined);
  const live = useRef(clip);
  live.current = clip;

  const commit = (next: RestyledClip, r: QualityResult) => {
    setClip(next);
    setResult(r);
    void deps.save(next).catch((error: unknown) => console.error('Motikord: could not save the quality fixes', error));
  };
  const run = (fixesUsed?: Record<string, number>) => {
    ctl.current?.abort();
    const ac = new AbortController();
    ctl.current = ac;
    setResult(undefined);
    const from = live.current;
    deps.check(from, look, ac.signal, fixesUsed).then((r) => {
      if (ac.signal.aborted) return;
      if (r.fixed.length) commit(withFixes(from, r, QUALITY.fixedCount(r.fixed.length)), r);
      else setResult(r);
    }).catch((error: unknown) => { if (!ac.signal.aborted) console.error('Motikord: could not run the quality check', error); });
  };
  useEffect(() => { run(); return () => ctl.current?.abort(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!result) return <main data-frame="CriticV3" role="status" style={{ flexGrow: 1, padding: 16, fontSize: 14 }}>{`${QUALITY.title} · ${clip.recipe.name}`}</main>;
  const fix = (notes: QualityNote[]) => {
    let r = result;
    let next = clip;
    for (const n of notes) {
      const f = applyFix(n, { recipe: r.recipe, clip: r.clip, look });
      if (!f) continue;
      r = { ...r, recipe: f.recipe, clip: f.clip, toLookAt: r.toLookAt.filter((x) => x !== n), fixed: [...r.fixed, { sceneIndex: n.sceneIndex, kind: n.kind, line: f.line, before: { recipe: r.recipe, clip: r.clip } }] };
      next = withFixes(next, f, f.line);
    }
    if (r !== result) commit(next, r);
  };
  const undo = (i: number) => {
    const f = result.fixed[i];
    if (!f) return;
    commit(withFixes(clip, f.before, `${f.line} undone`), { ...result, ...f.before, fixed: result.fixed.slice(0, i) });
  };
  const again = () => { const used = result.fixesUsed; void Promise.resolve(onAsk?.()).then(() => run(used)); };
  return (
    <CriticV3 name={clip.recipe.name} result={result} provider={provider} onFix={(n) => fix([n])} onFixAll={() => fix(result.toLookAt)} onUndo={undo}
      onShow={onShow} onCheckAgain={again} onRetry={again} onPasteKey={onPasteKey} onChangeModel={onChangeModel} />
  );
}

/** The CriticV3 route: reads the stored v3 clip and its look, then runs the check. */
export default function CriticV3Route() {
  const { route, replace } = useRouter();
  const win = useWindowId();
  const clipId = route.params.clipId ?? new URLSearchParams(location.search).get('clip') ?? undefined;
  const [open, setOpen] = useState<{ clip: RestyledClip; look: LookGuide; settings?: Settings } | null>();
  useEffect(() => {
    let alive = true;
    void (async () => {
      const clip = clipId ? await getClip(clipId) : undefined;
      if (!clip || !isRestyled(clip)) return alive && setOpen(null);
      const [look, settings] = await Promise.all([clipLook(clip), getSettings().catch(() => undefined)]);
      if (alive) setOpen({ clip, look, settings });
    })().catch((error: unknown) => { console.error('Motikord: could not open the clip', error); if (alive) setOpen(null); });
    return () => { alive = false; };
  }, [clipId]);
  const toEditor = () => replace('Editor', { clipId });
  if (open === undefined) return <main data-frame="CriticV3" />;
  if (open === null) return <main data-frame="CriticV3" style={{ flexGrow: 1, display: 'grid', placeItems: 'center', padding: 16 }}><div style={{ width: 400, maxWidth: '100%' }}><ClipNotFound onGo={toEditor} label="Close" /></div></main>;
  const s = open.settings;
  const provider = s?.ai === 'local' ? 'Built-in AI' : PROVIDERS[s?.provider ?? 'groq'].label;
  return (
    <CriticV3Live clip={open.clip} look={open.look} provider={provider} onShow={toEditor}
      onPasteKey={() => goInSidePanel(win.current, 'PasteKey')} onChangeModel={() => goInSidePanel(win.current, 'Settings')}
      onAsk={() => (s?.ai === 'cloud' ? requestHost(HOSTS[s.provider]) : undefined)} />
  );
}
