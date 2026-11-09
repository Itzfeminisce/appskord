import { useEffect, useMemo, useState } from 'react';
import { useRouter } from '../../entrypoints/sidepanel/router';
import { PACKS_V3, type PackId } from '../../lib/look/packs';
import { makeFromTemplateV3 } from '../../lib/makeClip';
import { send } from '../../lib/messages';
import { CLIP_TEMPLATES_V3 as ALL, clipTemplateRecipe, type ClipTemplateV3 } from '../../lib/templates/v3/clips';
import type { ClipType, Recipe } from '../../lib/types';
import { SceneThumb } from '../../screens/makeParts';
import { BackButton } from '../../screens/Setup';
import { onceAtATime, TYPE_NAMES, TYPE_ORDER } from '../../screens/Templates';
import { TEMPLATES } from './copy';

const sel = (on: boolean) => on
  ? { border: '1px solid var(--accent)', background: 'var(--tint)', color: 'var(--accent-hover)', fontWeight: 600 }
  : { border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 400 };

/** Where the v2 packs end and the four new ones begin. */
const NEW: readonly PackId[] = ['studio', 'kinetic', 'gloss', 'soft'];
const packOf = (id: PackId) => PACKS_V3.find((p) => p.id === id)!;
const light = (hex: string) => {
  const n = parseInt(hex.slice(1, 7), 16);
  return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 > 150;
};

const RECIPES = new Map<string, Recipe>();
const recipeOf = (t: ClipTemplateV3) => {
  let r = RECIPES.get(t.id);
  if (!r) RECIPES.set(t.id, (r = clipTemplateRecipe(t)));
  return r;
};

const startFromTemplate = onceAtATime(async (t: ClipTemplateV3) => {
  try {
    const clip = await makeFromTemplateV3(t);
    await send({ type: 'editor/open', clipId: clip.id });
  } catch (error) {
    console.error('Motikord: could not start from the template', error);
  }
});

/** The first scene, still; it plays while the card is hovered or focused. */
function Thumb({ t, playing }: { t: ClipTemplateV3; playing: boolean }) {
  const recipe = recipeOf(t);
  const [at, setAt] = useState(2200);
  useEffect(() => {
    if (!playing) { setAt(2200); return; }
    const ms = recipe.scenes[0]?.durationMs ?? 3000;
    let now = 0;
    const timer = setInterval(() => setAt((now = (now + 100) % ms)), 100);
    return () => clearInterval(timer);
  }, [playing, recipe]);
  return <SceneThumb recipe={recipe} index={0} width={178} height={316} atMs={at} style={{ width: '100%', height: '100%' }} />;
}

function Card({ t }: { t: ClipTemplateV3 }) {
  const [hover, setHover] = useState(false);
  const pack = packOf(t.packId);
  const seconds = Math.round(t.lengthMs / 1000);
  const bg = pack.colours[0]!;
  return (
    <li>
      <button type="button" onClick={() => void startFromTemplate(t)} aria-label={`${t.name}, ${TYPE_NAMES[t.type]} template, ${t.scenes.length} scenes, ${seconds} seconds, ${pack.name} style. Open your own copy`}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onFocus={() => setHover(true)} onBlur={() => setHover(false)}
        style={{ width: '100%', border: 0, background: 'none', padding: 0, font: 'inherit', textAlign: 'left', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer' }}>
        <span style={{ position: 'relative', width: '100%', aspectRatio: '9 / 16', borderRadius: 14, overflow: 'hidden', display: 'block', boxShadow: hover ? '0 0 0 2px var(--accent), 0 14px 28px -14px rgba(11,11,16,0.8)' : '0 1px 2px rgba(16,16,20,0.06), 0 8px 20px rgba(16,16,20,0.10)' }}>
          <Thumb t={t} playing={hover} />
          {hover && (
            <span style={{ position: 'absolute', left: 8, top: 8, height: 22, padding: '0 8px 0 6px', borderRadius: 999, background: 'rgba(11,11,16,0.7)', border: '1px solid rgba(255,255,255,0.14)', color: '#F5F5F7', fontSize: 10, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="#F5F5F7" aria-hidden="true"><path d="M7 5v14l12-7z" /></svg>{TEMPLATES.hover}
            </span>
          )}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>{t.name}</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: light(bg) ? '#111114' : '#F5F5F7', background: bg, boxShadow: light(bg) ? 'inset 0 0 0 1px var(--line)' : 'none', padding: '2px 7px', borderRadius: 999 }}>{pack.name}</span>
        </span>
        <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: -4, whiteSpace: 'nowrap' }}>{t.scenes.length} scenes · {seconds} s</span>
      </button>
    </li>
  );
}

/** TemplatesListV3: the 12 v3 clip templates by type and style; a tap makes your own v3 clip and opens it. */
export default function TemplatesListV3() {
  const { back } = useRouter();
  const [type, setType] = useState<ClipType | 'all'>('all');
  const [style, setStyle] = useState<PackId | 'any'>('any');
  const fits = (t: ClipTemplateV3) => type === 'all' || t.type === type;
  const shown = useMemo(() => ALL.filter((t) => fits(t) && (style === 'any' || t.packId === style)), [type, style]);
  return (
    <main data-frame="TemplatesListV3" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', paddingBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '12px 12px 0' }}>
        <BackButton onBack={back} />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{TEMPLATES.title}</h1>
      </div>
      <p style={{ margin: '10px 24px 0', fontSize: 12, lineHeight: 1.5, color: 'var(--muted)' }}>{TEMPLATES.line}</p>
      <div role="group" aria-label={TEMPLATES.type} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '14px 0 0', padding: '0 16px' }}>
        {([['all', 'All'], ...TYPE_ORDER.map((t) => [t, TYPE_NAMES[t]])] as [ClipType | 'all', string][]).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={type === id} onClick={() => { setType(id); if (style !== 'any' && !ALL.some((t) => (id === 'all' || t.type === id) && t.packId === style)) setStyle('any'); }}
            style={{ height: 30, padding: '0 12px', borderRadius: 999, ...sel(type === id), fontSize: 13, fontFamily: 'var(--font)', cursor: 'pointer' }}>{label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '14px 16px 0', fontSize: 12 }}>
        <span className="mono" style={{ fontWeight: 600, color: 'var(--muted)' }}>{TEMPLATES.style(style === 'any' ? TEMPLATES.any : packOf(style).name)}</span>
        <span style={{ color: 'var(--faint)' }}>{TEMPLATES.newInV3}</span>
      </div>
      <div role="group" aria-label="Style" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 16px 0' }}>
        {PACKS_V3.map((p) => {
          const on = style === p.id;
          const empty = !ALL.some((t) => fits(t) && t.packId === p.id);
          const fresh = NEW.includes(p.id);
          return (
            <button key={p.id} type="button" title={p.name} aria-label={fresh ? `${p.name} (new)` : p.name} aria-pressed={on} disabled={empty} onClick={() => setStyle(on ? 'any' : p.id)}
              style={{ width: 44, height: 44, borderRadius: 10, ...sel(on), background: p.colours[0], color: p.colours[1], font: `${p.fonts.display.weight} 15px '${p.fonts.display.family}', sans-serif`, outline: on ? '2px solid var(--accent)' : fresh ? '1px dashed var(--accent)' : 'none', outlineOffset: 1, opacity: empty ? 0.4 : 1, cursor: empty ? 'default' : 'pointer' }}>Aa</button>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', margin: '14px 16px 0' }}>
        <span style={{ fontSize: 12, color: 'var(--faint)' }}>{TEMPLATES.count(shown.length)}</span>
        <span style={{ fontSize: 12, color: 'var(--faint)' }}>{TEMPLATES.tap}</span>
      </div>
      <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: '0 16px', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '16px 12px' }}>
        {shown.map((t) => <Card key={t.id} t={t} />)}
      </ul>
    </main>
  );
}
