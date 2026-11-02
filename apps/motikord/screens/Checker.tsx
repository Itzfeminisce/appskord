import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { criticModel, criticSkip, runCritic, type CriticRun, type FrameRenderer } from '../lib/ai/critic';
import { splitSummary } from '../lib/editor/changes';
import { reverted, takeBack } from '../lib/editor/history';
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
      const put = card.fix[0];
      if (put?.path.endsWith('/bg')) return { where, title: `${name} runs onto the block behind it`, body: `Part of “${text}” sits on a colour it can't be read on.`, action: 'Keep it off the block' };
      if (put?.path.endsWith('/background')) return { where, title: `${name} crosses two backgrounds`, body: `No one colour reads on both, so “${text}” needs a backing.`, action: 'Give it a backing' };
      if (put?.path.endsWith('/shadow')) return { where, title: `${name} sits on a picture`, body: `“${text}” has nothing behind it to stand out from the photo.`, action: 'Add a shadow' };
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
const AUTO_BY = 'check' as const;

/** The visual critic's last run per clip, for this editor tab (the critic only runs on a make or on Check again). */
const critics = new Map<string, CriticRun & { provider: Provider }>();
/** Keeps a critic run for a clip in this tab, as Check again does. */
export const keepCritic = (clipId: string, run: CriticRun & { provider: Provider }) => critics.set(clipId, run);
const v2Kinds: readonly Issue['kind'][] = ['overlap', 'crowding', 'empty', 'align', 'words', 'template-repeat'];

export function CheckerPanel() {
  const { state, brand, cache, edit, undo, select, go, remake, remakeEach, current } = useEditor();
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

  // A remade scene's critic notes are done with, here and in the run kept for this tab.
  const clipId = state.clip.id;
  const dropNotes = (si: number) => {
    const run = critics.get(clipId);
    if (!run) return;
    const next = { ...run, notes: run.notes.filter((x) => x.sceneIndex !== si) };
    critics.set(clipId, next);
    setCritic(next);
  };
  const fixOne = (card: Card, action: string) => edit({ ops: card.fix, summary: action }, { toast: true });
  // Critic notes still about a scene that exists; each is fixed by remaking its scene with the note as the request.
  const notes = (critic?.notes ?? []).filter((x) => r.scenes[x.sceneIndex]);
  const gone = reverted(state.clip.history);
  const fixed = state.clip.history.filter((c) => c.by === AUTO_BY && !gone.has(c.id));
  const total = cards.length + notes.length;
  const fixAll = () => {
    if (cards.length) edit({ ops: mergeFixes(cards), summary: `Fixed ${noun(cards.length)}` }, { toast: true });
    // Each critic scene is remade in turn, as its own Change; notes on one scene go in one request.
    const asks = new Map<string, string[]>();
    for (const x of notes) asks.set(r.scenes[x.sceneIndex]!.id, [...(asks.get(r.scenes[x.sceneIndex]!.id) ?? []), x.fix]);
    remakeEach([...asks].map(([sceneId, fixes]) => ({ sceneId, request: fixes.join(' '), done: () => dropNotes(sceneIndex(r, sceneId)) })));
    go('Editor');
  };
  const show = (sceneId: string, layerId: string, aspects: Aspect[]) => {
    const to = aspects.includes(r.aspect) ? undefined : aspects[0];
    if (to) edit(setAspect(r, to));
    if (sceneIndex(r, sceneId) >= 0) select(sceneId, layerId || undefined);
    go('Editor');
  };
  const undoFix = (id: string) => {
    const c = state.clip.history.find((x) => x.id === id);
    if (!c) return;
    // The newest change is undone in place; an older fix is taken back as a new change, leaving later ones alone.
    const back = takeBack(state.clip.history, id, `${splitSummary(c.summary).title} undone`);
    if (back === 'undo') undo();
    else if (back) edit(back, { toast: true });
  };

  /** "Check again": the safe fixes as one Change each, then the visual critic when Settings has it on. */
  const checkAgain = () => {
    // Host access is asked for now, inside the click; which model looks is settled after.
    const on = !!settings?.critic;
    const access: Promise<HostAccess> | undefined = !settings || !on ? undefined : settings.ai === 'cloud' ? requestHost(HOSTS[settings.provider]) : Promise.resolve('granted');
    for (const e of autoFixEdits(current(), { measure: pageMeasure(), brand })) edit(e, { by: AUTO_BY });
    if (!access || !settings) return;
    const ac = new AbortController();
    stop.current?.abort();
    stop.current = ac;
    setChecking(true);
    void (async () => {
      try {
        const model = await criticModel(settings, { signal: ac.signal });
        if (criticSkip(settings.critic, model) || (await access) === 'denied') return;
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
    return (
      <IssueCard key={card.id} kind={card.kind} thumb={si >= 0 ? <SceneThumb recipe={r} aspect={card.aspects[0] ?? r.aspect} timeMs={restTime(r, si)} {...thumbSize(card.aspects[0] ?? r.aspect, 64)} /> : undefined}
        where={v ? where : cardText(card, r).where} title={t.title} body={t.body}
        action={card.fix.length > 0 && t.action ? { label: t.action, run: () => fixOne(card, t.action) } : undefined}
        onShow={() => show(card.sceneId, card.layerId, card.aspects)} />
    );
  };

  return (
    <section role="dialog" aria-label="Quality check" data-screen="Checker" style={{ position: 'fixed', top: 52, right: 0, bottom: 0, width: 400, zIndex: 30, display: 'flex', flexDirection: 'column', background: '#F6F6F7', borderLeft: '1px solid var(--line)', boxShadow: '-12px 0 32px rgba(16,16,20,0.08)' }}>
      <header style={{ flexShrink: 0, background: 'var(--surface)', borderBottom: '1px solid var(--line)', padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Quality check</h1>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => go('Editor')} style={{ width: 36, height: 36, marginRight: -8, color: 'var(--muted)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>
        {!v2 && cards.length > 0 && <span style={{ fontSize: 14, color: 'var(--muted)' }}>{`${noun(cards.length)} to fix before you export. Motikord checks every size after each change.`}</span>}
        {v2 && (total > 0 || fixed.length > 0) && <span style={{ fontSize: 14, color: 'var(--muted)' }}>{`${noun(total)} to look at · ${fixed.length} fixed for you`}</span>}
      </header>
      <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px' }}>
        {total === 0 && fixed.length === 0 && <AllGood />}
        {v2 && fixed.length > 0 && (
          <>
            <span style={head}><span style={{ fontSize: 15, fontWeight: 600 }}>Fixed for you</span><span style={{ fontSize: 12, fontWeight: 600, color: 'var(--success-ink)' }}>{`${fixed.length} done`}</span></span>
            <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: '2px 14px' }}>
              {[...fixed].reverse().map((c, i) => {
                const { title, detail } = splitSummary(c.summary);
                return (
                  <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 0', borderTop: i ? '1px solid var(--line)' : 0 }}>
                    <span aria-hidden="true" style={{ width: 20, height: 20, borderRadius: '50%', background: '#DCFCE7', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--success-ink)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35 }}>{title}</span>
                      {detail && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{detail}</span>}
                    </span>
                    <button type="button" onClick={() => undoFix(c.id)} style={plain}>Undo</button>
                  </div>
                );
              })}
            </div>
          </>
        )}
        {v2 && cards.length > 0 && <span style={head}><span style={{ fontSize: 15, fontWeight: 600 }}>Layout</span><span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>{`${cards.length} found`}</span></span>}
        {cards.map(layoutCard)}
        {v2 && critic && (
          <>
            <span style={head}><span style={{ fontSize: 15, fontWeight: 600 }}>{`Visual critic · ${PROVIDERS[critic.provider].label} looked at ${critic.frames} frames`}</span><span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', flexShrink: 0 }}>{`${notes.length} found`}</span></span>
            {notes.map((x) => {
              const scene = r.scenes[x.sceneIndex]!;
              return (
                <IssueCard key={`${scene.id}-${x.problem}`} kind="critic" thumb={<SceneThumb recipe={r} aspect={r.aspect} timeMs={restTime(r, x.sceneIndex)} {...thumbSize(r.aspect, 64)} />}
                  where={`Scene ${x.sceneIndex + 1} · ${r.aspect}`} title={x.problem} body=""
                  action={{ label: `Fix scene ${x.sceneIndex + 1}`, run: () => { remake(scene.id, x.fix, () => dropNotes(x.sceneIndex)); go('Editor'); } }}
                  onShow={() => show(scene.id, '', [r.aspect])} />
              );
            })}
          </>
        )}
        {v2 && (
          <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)', padding: '0 2px' }}>
            {critic ? `${critic.frames} small frames went to ${PROVIDERS[critic.provider].label} to check how the clip looks. You can turn the visual critic off in ` : 'The layout check runs on this computer after every change. Turn the visual critic on or off in '}
            <button type="button" onClick={openSettings} style={{ padding: 0, border: 0, background: 'none', font: 'inherit', color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline' }}>Settings</button>.
          </span>
        )}
        {!v2 && cards.length > 0 && <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>Each fix is one step you can undo.</span>}
      </div>
      {(total > 0 || v2) && (
        <footer style={{ flexShrink: 0, background: 'var(--surface)', borderTop: '1px solid var(--line)', padding: '14px 16px', display: 'flex', gap: 8 }}>
          {total > 0 && (
            <button type="button" className="btn btn-primary" onClick={fixAll} style={{ flexGrow: 1, height: 48, borderRadius: 12, fontSize: 14, fontWeight: 600 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
              {`Fix all ${total}`}
            </button>
          )}
          {v2 && <button type="button" className="btn" disabled={checking} onClick={checkAgain} style={{ flexGrow: total > 0 ? 0 : 1, height: 48, padding: '0 16px', borderRadius: 12, border: '1px solid var(--line-strong)', background: 'var(--surface)', fontSize: 14 }}>Check again</button>}
        </footer>
      )}
    </section>
  );
}

/** One problem: a sketch of the scene, the scene and size tag, what is wrong, the fix and "Show me" (CheckerV2). */
function IssueCard({ kind, thumb, where, title, body, action, onShow }: { kind: string; thumb?: ReactNode; where: string; title: string; body: string; action?: { label: string; run: () => void }; onShow: () => void }) {
  return (
    <div data-kind={kind} style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        {thumb && <span aria-hidden="true" style={{ width: 96, height: 84, flexShrink: 0, borderRadius: 10, background: '#F1F1F3', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>{thumb}</span>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
          <span style={{ alignSelf: 'flex-start', height: 20, padding: '0 7px', borderRadius: 6, background: '#F1F1F3', color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 11, display: 'flex', alignItems: 'center' }}>{where}</span>
          <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.3 }}>{title}</span>
          {body && <span style={{ fontSize: 13, lineHeight: 1.4, color: 'var(--muted)' }}>{body}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {action && <button type="button" onClick={action.run} style={{ height: 40, padding: '0 16px', border: 0, borderRadius: 10, background: 'var(--accent)', boxShadow: '0 1px 2px rgba(190,24,93,0.25)', color: '#fff', font: '600 13px/1 var(--font)', cursor: 'pointer' }}>{action.label}</button>}
        <button type="button" onClick={onShow} style={{ height: 40, padding: '0 14px', border: '1px solid var(--line-strong)', borderRadius: 10, background: 'var(--surface)', color: 'var(--ink)', font: '500 13px/1 var(--font)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
          Show me
        </button>
      </div>
    </div>
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
