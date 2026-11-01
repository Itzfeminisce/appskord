import { useEffect, useMemo, useRef, useState } from 'react';
import { criticModel, criticSkip, runCritic, type CriticRun, type FrameRenderer } from '../lib/ai/critic';
import { splitSummary } from '../lib/editor/changes';
import { autoFixEdits, layoutText, repeatRun } from '../lib/editor/checks';
import { HOSTS, requestHost, type HostAccess } from '../lib/hostAccess';
import { PROVIDERS } from '../lib/providers';
import { renderFrames } from '../lib/render/frames';
import { getSettings } from '../lib/settings';
import { openSidePanelOn } from '../lib/sidepanelGo';
import { SceneThumb, thumbSize } from './editor/SceneThumb';
import { TemplateRepeat } from './editor/StatesV2';
import { check, contrastRatio, MIN_TEXT_PX, readMs } from '../lib/checker';
import { findLayer, restTime, sceneIndex, setAspect } from '../lib/editor/store';
import type { Measure } from '../lib/render/textFit';
import type { Aspect, Issue, LicenceId, PatchOp, Provider, Recipe, Settings, TextLayer } from '../lib/types';
import Editor, { useEditor } from './editor/Editor';

// Quality check (Checker, checker-all-good). It is a panel over the editor, so Fix all and Show me act on the open clip.
// The route renders the Editor itself, which draws this panel while the route is Checker.
export default Editor;

const ASPECT_ORDER: Aspect[] = ['9:16', '1:1', '16:9'];
const LICENCE: Partial<Record<LicenceId, string>> = { 'cc-by': 'CC BY 4.0', 'cc-by-sa': 'CC BY-SA 4.0', 'cc-by-nc': 'CC BY-NC 4.0' };

/** Text width measured on a canvas, in the font the preview draws. Falls back to the checker's estimate where there is no canvas. */
export function pageMeasure(): Measure | undefined {
  if (typeof OffscreenCanvas === 'undefined') return undefined;
  const ctx = new OffscreenCanvas(1, 1).getContext('2d');
  if (!ctx) return undefined;
  return (text, px) => {
    ctx.font = `600 ${px}px Geist, system-ui, sans-serif`;
    return ctx.measureText(text).width;
  };
}

/** One card: the same problem on one or more sizes. */
export interface Card { id: string; kind: Issue['kind']; sceneId: string; layerId: string; aspects: Aspect[]; fix: PatchOp[]; note?: string }

/** Issues that share a layer, kind and fix are one card ("all sizes"). */
export function groupIssues(issues: Issue[]): Card[] {
  const cards = new Map<string, Card>();
  for (const i of issues) {
    const key = [i.kind, i.sceneId, i.layerId, JSON.stringify(i.fix)].join('|');
    const card = cards.get(key);
    if (card) card.aspects.push(i.aspect);
    else cards.set(key, { id: i.id, kind: i.kind, sceneId: i.sceneId, layerId: i.layerId, aspects: [i.aspect], fix: i.fix, ...(i.note ? { note: i.note } : {}) });
  }
  return [...cards.values()].map((c) => ({ ...c, aspects: ASPECT_ORDER.filter((a) => c.aspects.includes(a)) }));
}

/** Every card's fix as one patch: repeats collapse and per-size boxes added to one layer join into one object. */
export function mergeFixes(cards: Pick<Card, 'fix'>[]): PatchOp[] {
  const out: PatchOp[] = [];
  const at = new Map<string, number>();
  for (const op of cards.flatMap((c) => c.fix)) {
    const key = `${op.op === 'remove' ? 'remove' : 'put'} ${op.path}`;
    const i = at.get(key);
    if (i === undefined) { at.set(key, out.length); out.push(op); continue; }
    const prev = out[i]!;
    const isBoxes = op.op === 'add' && prev.op === 'add' && op.path.endsWith('/boxes');
    out[i] = isBoxes ? { ...op, value: { ...(prev as { value: object }).value, ...(op.value as object) } } : op;
  }
  return out;
}

const sizesLabel = (a: Aspect[]) => (a.length === ASPECT_ORDER.length ? 'all sizes' : a.join(', '));
const lightness = (hex: string) => ((contrastRatio(hex, '#FFFFFF') ?? 0) < (contrastRatio(hex, '#111114') ?? 0) ? 'light' : 'dark');
const firstLine = (t: string) => t.split('\n')[0]!.trim();

export interface CardText { where: string; title: string; body: string; action: string }

/** The words on a card, from the frame's wording filled in with the clip's own layer and numbers. */
export function cardText(card: Card, r: Recipe): CardText {
  const found = findLayer(r, card.sceneId, card.layerId);
  const l = found?.layer;
  const name = l?.name ?? 'Text';
  const text = l?.type === 'text' ? firstLine(l.text) : '';
  const si = sceneIndex(r, card.sceneId);
  const where = `${si < 0 ? 'Music' : `Scene ${si + 1}`} · ${card.kind === 'credit-missing' ? 'all sizes' : sizesLabel(card.aspects)}`;
  switch (card.kind) {
    case 'safe-area': {
      const last = text.split(/\s+/).filter(Boolean).pop();
      return { where, title: `${name} runs outside the safe area`, action: 'Shrink to fit',
        body: `Some apps cover the edges with buttons, so ${last ? `the end of “${last}”` : 'part of it'} may be hidden.` };
    }
    case 'overflow':
      return { where, title: `${name} is too big for its box`, body: `Part of “${text}” would be cut off.`, action: 'Shrink to fit' };
    case 'contrast': {
      // The fix is the colour that reads best, so the trouble is text and background both being the other tone.
      const value = (card.fix[0] as { value?: unknown } | undefined)?.value;
      const tone = lightness(String(value ?? '#FFFFFF')) === 'light' ? 'dark' : 'light';
      return { where, title: `Hard to read: ${tone} text on a ${tone} background`, body: `“${text}” blends into the background.`, action: `Make the text ${tone === 'light' ? 'dark' : 'light'}` };
    }
    case 'too-fast': {
      const read = l?.type === 'text' ? Math.ceil(readMs((l as TextLayer).text) / 100) / 10 : 0;
      return { where, title: `${name} goes by too fast`, body: read ? `“${text}” needs about ${read} seconds to read.` : '', action: 'Give it more time' };
    }
    case 'too-small': {
      const px = l?.type === 'text' ? Math.round(l.sizePx) : 0;
      return { where, title: 'Too small to read on a phone', body: `The ${name.toLowerCase()} line is ${px} px. ${MIN_TEXT_PX} px reads well.`, action: `Make it ${MIN_TEXT_PX} px` };
    }
    case 'credit-missing': {
      const m = l && (l.type === 'image' || l.type === 'video') ? r.assets[l.assetId] : r.music && r.assets[r.music.assetId];
      const c = m?.credit;
      return { where, title: 'Credit needed', action: 'Add an end card with these credits',
        body: c ? `“${c.title}” by ${c.author} · ${LICENCE[c.licence] ?? c.licence}` : '' };
    }
    // v2 kinds (overlap, crowding, ...) get their frame wording in the v2 checker task.
    default:
      return { where, title: name, body: '', action: '' };
  }
}

/** The editor's issue list, measured with the page's font. */
export function useIssues(): { issues: Issue[]; cards: Card[] } {
  const { state } = useEditor();
  const { brand } = useEditor();
  const r = state.clip.recipe;
  return useMemo(() => {
    const issues = check(r, { measure: pageMeasure(), brand });
    return { issues, cards: groupIssues(issues) };
  }, [r, brand]);
}

const noun = (n: number) => `${n} ${n === 1 ? 'thing' : 'things'}`;

const btn = { height: 32, padding: '0 12px', borderRadius: 8, font: '600 12px/1 var(--font)', cursor: 'pointer' } as const;
const solid = { ...btn, border: 0, background: 'var(--ink)', color: '#fff' } as const;
const plain = { ...btn, fontWeight: 500, border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--ink)' } as const;
const head = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 4 } as const;
const AUTO_BY = 'template' as const;

/** The visual critic's last run per clip, for this editor tab (the critic only runs on a make or on Check again). */
const critics = new Map<string, CriticRun & { provider: Provider }>();
const v2Kinds: readonly Issue['kind'][] = ['overlap', 'crowding', 'empty', 'align', 'words', 'template-repeat'];

export function CheckerPanel() {
  const { state, brand, cache, edit, undo, select, go, remake, current } = useEditor();
  const { cards } = useIssues();
  const r = state.clip.recipe;
  const v2 = r.scenes.some((x) => x.template);
  const [settings, setSettings] = useState<Settings>();
  const [critic, setCritic] = useState(() => critics.get(state.clip.id));
  const [checking, setChecking] = useState(false);
  const stop = useRef<AbortController>(undefined);

  useEffect(() => { void getSettings().then(setSettings).catch(() => undefined); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') go('Editor'); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); stop.current?.abort(); };
  }, [go]);

  const fixOne = (card: Card, action: string) => edit({ ops: card.fix, summary: action }, { toast: true });
  // Critic notes still about a scene that exists; each is fixed by remaking its scene with the note as the request.
  const notes = (critic?.notes ?? []).filter((x) => r.scenes[x.sceneIndex]);
  const fixed = state.clip.history.filter((c) => c.by === AUTO_BY);
  const total = cards.length + notes.length;
  const fixAll = () => {
    if (cards.length) edit({ ops: mergeFixes(cards), summary: `Fixed ${noun(cards.length)}` }, { toast: true });
    const first = notes[0];
    if (first) remake(r.scenes[first.sceneIndex]!.id, first.fix);
    go('Editor');
  };
  const show = (sceneId: string, layerId: string, aspects: Aspect[]) => {
    const to = aspects.includes(r.aspect) ? undefined : aspects[0];
    if (to) edit(setAspect(r, to));
    if (sceneIndex(r, sceneId) >= 0) select(sceneId, layerId || undefined);
    go('Editor');
  };
  const undoFix = (id: string) => {
    const h = state.clip.history;
    const c = h.find((x) => x.id === id);
    if (!c) return;
    // The newest change is undone in place; an older fix is taken back as a new change, leaving later ones alone.
    if (h[h.length - 1]?.id === id) undo();
    else edit({ ops: c.inverse, summary: `${splitSummary(c.summary).title} undone` }, { toast: true });
  };

  /** "Check again": the safe fixes as one Change each, then the visual critic when Settings has it on. */
  const checkAgain = () => {
    const model = settings && criticModel(settings);
    const skip = settings ? criticSkip(settings.critic, model!) : 'critic-off';
    const access: Promise<HostAccess> | undefined = !skip && model?.ai === 'cloud' ? requestHost(HOSTS[model.provider]) : !skip ? Promise.resolve('granted') : undefined;
    for (const e of autoFixEdits(current(), { measure: pageMeasure(), brand })) edit(e, { by: AUTO_BY });
    if (!access || !model) return;
    const ac = new AbortController();
    stop.current?.abort();
    stop.current = ac;
    setChecking(true);
    void (async () => {
      try {
        if ((await access) === 'denied') return;
        const render: FrameRenderer = (rec, times) => renderFrames(rec, times, { cache });
        const run = await runCritic(current(), render, { signal: ac.signal });
        const out = { ...run, provider: model.provider };
        critics.set(state.clip.id, out);
        if (!ac.signal.aborted) setCritic(out);
      } catch (error) {
        if (!ac.signal.aborted) console.error('Motikord: could not run the visual check', error);
      } finally {
        if (stop.current === ac) setChecking(false);
      }
    })();
  };
  const openSettings = () => { void browser.windows.getCurrent().then((w) => w.id !== undefined && openSidePanelOn(w.id, 'Settings')).catch(() => undefined); };

  const layoutCard = (card: Card) => {
    const si = sceneIndex(r, card.sceneId);
    const where = si < 0 ? cardText(card, r).where : `Scene ${si + 1} · ${sizesLabel(card.aspects)}`;
    if (card.kind === 'template-repeat') {
      const run = repeatRun(r, card.sceneId);
      return <div key={card.id} data-kind={card.kind}><TemplateRepeat scenes={run.scenes} template={run.template} onSwap={() => (card.fix.length ? fixOne(card, `Swap scene ${si + 1}`) : go('Editor'))} /></div>;
    }
    const v = v2Kinds.includes(card.kind) ? layoutText(card.kind, r, card.sceneId, card.layerId, card.aspects[0] ?? r.aspect, card.fix, card.note) : undefined;
    const t = v ?? cardText(card, r);
    const size = thumbSize(card.aspects[0] ?? r.aspect, 64);
    return (
      <div key={card.id} data-kind={card.kind} style={{ padding: 12, borderRadius: 12, border: '1px solid var(--warning-line)', background: 'var(--warning-bg)', display: 'flex', gap: 10 }}>
        {si >= 0 && <SceneThumb recipe={r} aspect={card.aspects[0] ?? r.aspect} timeMs={restTime(r, si)} w={size.w} h={size.h} />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flexGrow: 1 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--warning-ink)' }}>{v ? where : cardText(card, r).where}</span>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{t.title}</span>
          {t.body && <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>{t.body}</span>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {card.fix.length > 0 && t.action && <button type="button" onClick={() => fixOne(card, t.action)} style={solid}>{t.action}</button>}
            <button type="button" onClick={() => show(card.sceneId, card.layerId, card.aspects)} style={plain}>Show me</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <section role="dialog" aria-label="Quality check" data-screen="Checker" style={{ position: 'absolute', top: 64, right: 12, bottom: 12, width: 380, zIndex: 20, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, boxShadow: '0 12px 32px rgba(16,16,20,0.12)', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Quality check</h1>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => go('Editor')} style={{ width: 32, height: 32 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      {!v2 && cards.length === 0 && <AllGood />}
      {!v2 && cards.length > 0 && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{`${noun(cards.length)} to fix before you export. Motikord checks every size after each change.`}</p>}
      {v2 && <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{`${noun(total)} to look at · ${fixed.length} fixed for you`}</p>}
      {v2 && total === 0 && <AllGood />}
      {v2 && fixed.length > 0 && (
        <>
          <span style={head}><span style={{ fontSize: 13, fontWeight: 600 }}>Fixed for you</span><span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>{`${fixed.length} done`}</span></span>
          {[...fixed].reverse().map((c) => {
            const { title, detail } = splitSummary(c.summary);
            return (
              <div key={c.id} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--success-line)', background: 'var(--success-bg)', display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
                  {detail && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{detail}</span>}
                </span>
                <button type="button" onClick={() => undoFix(c.id)} style={plain}>Undo</button>
              </div>
            );
          })}
        </>
      )}
      {v2 && cards.length > 0 && <span style={head}><span style={{ fontSize: 13, fontWeight: 600 }}>Layout</span><span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>{`${cards.length} found`}</span></span>}
      {cards.map(layoutCard)}
      {v2 && critic && (
        <>
          <span style={head}><span style={{ fontSize: 13, fontWeight: 600 }}>{`Visual critic · ${PROVIDERS[critic.provider].label} looked at ${critic.frames} frames`}</span><span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--faint)' }}>{`${notes.length} found`}</span></span>
          {notes.map((x) => {
            const scene = r.scenes[x.sceneIndex]!;
            const size = thumbSize(r.aspect, 64);
            return (
              <div key={`${scene.id}-${x.problem}`} data-kind="critic" style={{ padding: 12, borderRadius: 12, border: '1px solid var(--line)', display: 'flex', gap: 10 }}>
                <SceneThumb recipe={r} aspect={r.aspect} timeMs={restTime(r, x.sceneIndex)} w={size.w} h={size.h} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0, flexGrow: 1 }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>{`Scene ${x.sceneIndex + 1} · ${r.aspect}`}</span>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{x.problem}</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => { remake(scene.id, x.fix); go('Editor'); }} style={solid}>{`Fix scene ${x.sceneIndex + 1}`}</button>
                    <button type="button" onClick={() => show(scene.id, '', [r.aspect])} style={plain}>Show me</button>
                  </div>
                </div>
              </div>
            );
          })}
          <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--faint)' }}>
            {`${critic.frames} small frames went to ${PROVIDERS[critic.provider].label} to check how the clip looks. You can turn the visual critic off in `}
            <button type="button" onClick={openSettings} style={{ padding: 0, border: 0, background: 'none', font: 'inherit', color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}>Settings</button>.
          </span>
        </>
      )}
      <div style={{ flexGrow: 1 }} />
      {total > 0 && <button type="button" className="btn btn-primary btn-block" onClick={fixAll}>{`Fix all ${total}`}</button>}
      {v2
        ? <button type="button" className="btn btn-block" disabled={checking} onClick={checkAgain}>Check again</button>
        : cards.length > 0 && <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>Each fix is one step you can undo.</span>}
    </section>
  );
}

function AllGood() {
  return (
    <div role="status" data-state="checker-all-good" style={{ padding: 14, borderRadius: 14, background: 'var(--success-bg)', border: '1px solid var(--success-line)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Everything looks good</span>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: '#166534' }}>Text fits, reads well and stays inside the safe area in all three sizes.</span>
      </div>
    </div>
  );
}
