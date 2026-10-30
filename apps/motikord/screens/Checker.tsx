import { useMemo } from 'react';
import { check, contrastRatio, MIN_TEXT_PX, readMs } from '../lib/checker';
import { findLayer, sceneIndex, setAspect } from '../lib/editor/store';
import type { Measure } from '../lib/render/textFit';
import type { Aspect, Issue, LicenceId, PatchOp, Recipe, TextLayer } from '../lib/types';
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
export interface Card { id: string; kind: Issue['kind']; sceneId: string; layerId: string; aspects: Aspect[]; fix: PatchOp[] }

/** Issues that share a layer, kind and fix are one card ("all sizes"). */
export function groupIssues(issues: Issue[]): Card[] {
  const cards = new Map<string, Card>();
  for (const i of issues) {
    const key = [i.kind, i.sceneId, i.layerId, JSON.stringify(i.fix)].join('|');
    const card = cards.get(key);
    if (card) card.aspects.push(i.aspect);
    else cards.set(key, { id: i.id, kind: i.kind, sceneId: i.sceneId, layerId: i.layerId, aspects: [i.aspect], fix: i.fix });
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
  }
}

/** The editor's issue list, measured with the page's font. */
export function useIssues(): { issues: Issue[]; cards: Card[] } {
  const { state } = useEditor();
  const r = state.clip.recipe;
  return useMemo(() => {
    const issues = check(r, { measure: pageMeasure() });
    return { issues, cards: groupIssues(issues) };
  }, [r]);
}

const noun = (n: number) => `${n} ${n === 1 ? 'thing' : 'things'}`;

const btn = { height: 32, padding: '0 12px', borderRadius: 8, font: '600 12px/1 var(--font)', cursor: 'pointer' } as const;

export function CheckerPanel() {
  const { state, edit, select, go } = useEditor();
  const { cards } = useIssues();
  const r = state.clip.recipe;

  const fixOne = (card: Card, action: string) => edit({ ops: card.fix, summary: action }, { toast: true });
  const fixAll = () => {
    edit({ ops: mergeFixes(cards), summary: `Fixed ${noun(cards.length)}` }, { toast: true });
    go('Editor');
  };
  const show = (card: Card) => {
    const to = card.aspects.includes(r.aspect) ? undefined : card.aspects[0];
    if (to) edit(setAspect(r, to));
    if (si(card) >= 0) select(card.sceneId, card.layerId);
    go('Editor');
  };
  const si = (card: Card) => sceneIndex(r, card.sceneId);

  return (
    <section role="dialog" aria-label="Quality check" data-screen="Checker" style={{ position: 'absolute', top: 64, right: 12, bottom: 12, width: 360, zIndex: 20, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16, boxShadow: '0 12px 32px rgba(16,16,20,0.12)', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Quality check</h1>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => go('Editor')} style={{ width: 32, height: 32 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      {cards.length === 0 ? <AllGood /> : (
        <>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--muted)' }}>{`${noun(cards.length)} to fix before you export. Motikord checks every size after each change.`}</p>
          {cards.map((card) => {
            const t = cardText(card, r);
            return (
              <div key={card.id} data-kind={card.kind} style={{ padding: 12, borderRadius: 12, border: '1px solid var(--warning-line)', background: 'var(--warning-bg)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--warning-ink)' }}>{t.where}</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{t.title}</span>
                {t.body && <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>{t.body}</span>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button type="button" onClick={() => fixOne(card, t.action)} style={{ ...btn, border: 0, background: 'var(--ink)', color: '#fff' }}>{t.action}</button>
                  <button type="button" onClick={() => show(card)} style={{ ...btn, fontWeight: 500, border: '1px solid var(--line-strong)', background: 'var(--surface)', color: 'var(--ink)' }}>Show me</button>
                </div>
              </div>
            );
          })}
          <div style={{ flexGrow: 1 }} />
          <button type="button" className="btn btn-primary btn-block" onClick={fixAll}>{`Fix all ${cards.length}`}</button>
          <span style={{ textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>Each fix is one step you can undo.</span>
        </>
      )}
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
