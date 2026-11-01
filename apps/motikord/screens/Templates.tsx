import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '../entrypoints/sidepanel/router';
import { makeFromTemplate } from '../lib/makeClip';
import { send } from '../lib/messages';
import { drawFrame } from '../lib/render/drawFrame';
import { MediaCache } from '../lib/render/cache';
import { formatLength, TEMPLATES, type Template } from '../lib/templates';
import { autoStyle, getPack, STYLE_PACKS } from '../lib/templates/scenes';
import type { ClipType, Recipe, StyleId } from '../lib/types';
import { BackButton } from './Setup';

export const TYPE_NAMES: Record<ClipType, string> = {
  promo: 'Promo', quote: 'Quote', chart: 'Chart reveal', explainer: 'Explainer', logo: 'Logo intro', captions: 'Captions', social: 'Social post',
};
export const TYPE_ORDER: ClipType[] = ['promo', 'quote', 'chart', 'explainer', 'logo', 'captions', 'social'];

/** A recipe's first scene drawn small, once it has come in. Falls back to the scene colour where a canvas is not available. */
export function RecipeThumb({ recipe, height, atMs = 1800 }: { recipe: Recipe; height: number; atMs?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const first = recipe.scenes[0];
  const ratio = recipe.aspect === '9:16' ? 9 / 16 : recipe.aspect === '1:1' ? 1 : 16 / 9;
  const width = Math.round(height * ratio);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !first) return;
    try {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const scale = 2; // sharp on dense screens
      canvas.width = width * scale;
      canvas.height = height * scale;
      drawFrame(ctx, recipe, recipe.aspect, Math.min(atMs, first.durationMs - 1), new MediaCache());
    } catch (error) {
      console.error('Motikord: could not draw a thumbnail', error);
    }
  }, [recipe, width, height, atMs, first]);
  return (
    <span style={{ height, borderRadius: 10, background: first?.background === 'transparent' ? 'var(--stage)' : first?.background, border: '1px solid var(--line)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      <canvas ref={ref} aria-hidden="true" style={{ width, height, display: 'block' }} />
    </span>
  );
}

const sceneCount = (t: Template) => `${t.scenes} scene${t.scenes === 1 ? '' : 's'}`;
/** The v1 templates carry no style pack, so each takes the pack Auto would pick for its clip type; its thumbnail keeps its own look. */
export const packOf = (t: Template): StyleId => autoStyle(t.type);
/** "{type} · {n} scenes · {s} s" */
export const templateLine = (t: Template) => `${TYPE_NAMES[t.type]} · ${sceneCount(t)} · ${Math.round(t.lengthMs / 1000)} s`;

/** Makes your own copy of the template and opens it in the editor tab. */
/** Wraps an action so a second call while one is running does nothing. */
export function onceAtATime<A extends unknown[]>(run: (...args: A) => Promise<void>): (...args: A) => Promise<void> {
  let busy = false;
  return async (...args) => {
    if (busy) return;
    busy = true;
    try { await run(...args); } finally { busy = false; }
  };
}

const startFromTemplate = async (t: Template) => {
  try {
    const clip = await makeFromTemplate(t);
    await send({ type: 'editor/open', clipId: clip.id });
  } catch (error) {
    console.error('Motikord: could not start from the template', error);
  }
};

export function useUseTemplate() {
  return useMemo(() => onceAtATime(startFromTemplate), []);
}

export function TemplateCard({ template, height, onUse, pack }: { template: Template; height: number; onUse: (t: Template) => void; pack?: boolean }) {
  return (
    <button type="button" onClick={() => onUse(template)} aria-label={`${template.name}, ${TYPE_NAMES[template.type]}, ${formatLength(template.lengthMs)}`}
      style={{ border: 0, background: 'none', padding: 0, font: 'inherit', textAlign: 'left', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer', minWidth: 0 }}>
      <RecipeThumb recipe={template.recipe} height={height} />
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{template.name}</span>
        {!pack && <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{formatLength(template.lengthMs)}</span>}
      </span>
      <span style={{ fontSize: 12, color: 'var(--muted)', marginTop: -4 }}>{pack ? templateLine(template) : `${TYPE_NAMES[template.type]} · ${sceneCount(template)}`}</span>
      {pack && <span style={{ alignSelf: 'flex-start', fontSize: 11, fontWeight: 600, color: 'var(--accent-hover)', background: 'var(--tint-strong)', padding: '2px 8px', borderRadius: 999 }}>{getPack(packOf(template))?.name}</span>}
    </button>
  );
}

export default function Templates() {
  const { back } = useRouter();
  const use = useUseTemplate();
  const [filter, setFilter] = useState<ClipType | 'all'>('all');
  const [style, setStyle] = useState<StyleId | 'any'>('any');
  const shown = TEMPLATES.filter((t) => (filter === 'all' || t.type === filter) && (style === 'any' || packOf(t) === style));
  const chip = (id: ClipType | 'all', label: string) => {
    const on = filter === id;
    return (
      <button key={id} type="button" aria-pressed={on} onClick={() => setFilter(id)}
        style={{ height: 30, padding: '0 12px', borderRadius: 999, border: on ? 0 : '1px solid #E0E0E4', background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink)', font: `${on ? 500 : 400} 12px var(--font)`, cursor: 'pointer' }}>
        {label}
      </button>
    );
  };
  return (
    <main data-frame="Templates" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', paddingBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '20px 24px 0' }}>
        <BackButton onBack={back} />
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em', flexGrow: 1 }}>Templates</h1>
      </div>
      <span style={{ margin: '4px 24px 0', fontSize: 12, color: 'var(--muted)' }}>Every template keeps its look. Your brand kit replaces colours, fonts and logo.</span>
      <div role="group" aria-label="Clip type" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '12px 16px 0' }}>
        {chip('all', 'All')}
        {TYPE_ORDER.map((t) => chip(t, TYPE_NAMES[t]))}
      </div>
      <div role="group" aria-label="Style" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, padding: '8px 16px 0' }}>
        <span style={{ fontSize: 12, fontWeight: 600, marginRight: 4 }}>Style</span>
        {([['any', 'Any'], ...STYLE_PACKS.map((p) => [p.id, p.name])] as [StyleId | 'any', string][]).map(([id, name]) => {
          const on = style === id;
          return (
            <button key={id} type="button" aria-pressed={on} onClick={() => setStyle(id)}
              style={{ height: 30, padding: '0 12px', borderRadius: 999, border: on ? 0 : '1px solid #E0E0E4', background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink)', font: `${on ? 500 : 400} 12px var(--font)`, cursor: 'pointer' }}>{name}</button>
          );
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 24px 0' }}>
        <span className="mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{`${shown.length} templates`}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Tap one to open your own copy</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, padding: '14px 16px 0' }}>
        {shown.map((t) => <TemplateCard key={t.id} template={t} height={150} onUse={use} pack />)}
      </div>
      <span style={{ margin: 'auto 24px 0', paddingTop: 18, textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>A template becomes your own copy. Change anything with words or by hand.</span>
    </main>
  );
}
