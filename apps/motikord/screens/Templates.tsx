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
import { SceneThumb } from './makeParts';

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

const sel = (on: boolean) => on
  ? { border: '1px solid var(--accent)', background: 'var(--tint)', color: 'var(--accent-hover)', fontWeight: 600 }
  : { border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 400 };

/** The style's colour mark on its chip and tag. */
function StyleDot({ id, size = 8 }: { id: StyleId; size?: number }) {
  const p = getPack(id)?.palette;
  if (!p) return null;
  const mark = id === 'corporate' ? p.bg : p.accent;
  return <span aria-hidden="true" style={{ width: size, height: size, borderRadius: id === 'playful' ? '50%' : 2, background: mark, boxShadow: id === 'bold' ? `inset 0 0 0 1px ${p.bg}` : undefined, flexShrink: 0 }} />;
}

/** TemplatesV2 card: a tall 9:16 thumbnail, name, line and the pack tag. */
function TallCard({ template, onUse }: { template: Template; onUse: (t: Template) => void }) {
  const pack = packOf(template);
  const tall = useMemo(() => ({ ...template.recipe, aspect: '9:16' as const }), [template]);
  return (
    <li>
      <button type="button" onClick={() => onUse(template)} aria-label={`${template.name}, ${TYPE_NAMES[template.type]}, ${getPack(pack)?.name}. Opens your own copy`}
        style={{ width: '100%', border: 0, background: 'none', padding: 0, font: 'inherit', textAlign: 'left', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: 8, cursor: 'pointer' }}>
        <span style={{ width: '100%', aspectRatio: '9 / 16', borderRadius: 14, overflow: 'hidden', display: 'block', boxShadow: '0 1px 2px rgba(16,16,20,0.06), 0 8px 20px rgba(16,16,20,0.10)' }}>
          <SceneThumb recipe={tall} index={0} width={178} height={316} atMs={2200} style={{ width: '100%', height: '100%' }} />
        </span>
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{template.name}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{templateLine(template)}</span>
        </span>
        <span style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 8px', borderRadius: 6, background: 'var(--surface)', border: '1px solid var(--line)', fontSize: 11, fontWeight: 500, color: 'var(--muted)' }}>
          <StyleDot id={pack} size={7} />{getPack(pack)?.name}
        </span>
      </button>
    </li>
  );
}

export default function Templates() {
  const { back } = useRouter();
  const use = useUseTemplate();
  const [filter, setFilter] = useState<ClipType | 'all'>('all');
  const [style, setStyle] = useState<StyleId | 'any'>('any');
  const fits = (t: Template) => filter === 'all' || t.type === filter;
  const shown = TEMPLATES.filter((t) => (filter === 'all' || t.type === filter) && (style === 'any' || packOf(t) === style));
  const chip = (id: ClipType | 'all', label: string) => {
    const on = filter === id;
    return (
      <button key={id} type="button" aria-pressed={on} onClick={() => { setFilter(id); if (style !== 'any' && !TEMPLATES.some((t) => (id === 'all' || t.type === id) && packOf(t) === style)) setStyle('any'); }}
        style={{ height: 30, padding: '0 12px', borderRadius: 999, ...sel(on), fontSize: 13, fontFamily: 'var(--font)', cursor: 'pointer' }}>
        {label}
      </button>
    );
  };
  return (
    <main data-frame="Templates" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', paddingBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '12px 12px 0' }}>
        <BackButton onBack={back} />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Templates</h1>
      </div>
      <div style={{ margin: '10px 16px 0', padding: '10px 12px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}><path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--muted)' }}>Every template keeps its look. Your brand kit replaces colours, fonts and logo.</p>
      </div>
      <div role="group" aria-label="Type" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '14px 0 0', padding: '0 16px' }}>
        {chip('all', 'All')}
        {TYPE_ORDER.map((t) => chip(t, TYPE_NAMES[t]))}
      </div>
      <span id="style-label" style={{ margin: '14px 16px 0', fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Style</span>
      <div role="group" aria-labelledby="style-label" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, margin: '6px 16px 0' }}>
        {([['any', 'Any'], ...STYLE_PACKS.map((p) => [p.id, p.name])] as [StyleId | 'any', string][]).map(([id, name]) => {
          const on = style === id;
          const empty = id !== 'any' && !TEMPLATES.some((t) => fits(t) && packOf(t) === id);
          return (
            <button key={id} type="button" aria-pressed={on} aria-disabled={empty || undefined} disabled={empty} onClick={() => setStyle(id)}
              style={{ height: 28, padding: '0 10px', borderRadius: 8, ...sel(on), fontSize: 12, fontFamily: 'var(--font)', display: 'inline-flex', alignItems: 'center', gap: 6, cursor: empty ? 'default' : 'pointer', opacity: empty ? 0.4 : 1 }}>
              {id !== 'any' && <StyleDot id={id} />}{name}
            </button>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '14px 16px 0' }}>
        <span style={{ fontSize: 12, color: 'var(--faint)' }}>{`${shown.length} templates`}</span>
        <span style={{ fontSize: 12, color: 'var(--faint)' }}>Tap one to open your own copy</span>
      </div>
      <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: '0 16px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px 12px' }}>
        {shown.map((t) => <TallCard key={t.id} template={t} onUse={use} />)}
      </ul>
      <span style={{ margin: 'auto 24px 0', paddingTop: 18, textAlign: 'center', fontSize: 12, color: 'var(--faint)' }}>A template becomes your own copy. Change anything with words or by hand.</span>
    </main>
  );
}
