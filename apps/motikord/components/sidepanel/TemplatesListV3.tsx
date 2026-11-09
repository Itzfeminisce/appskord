import { useMemo, useState } from 'react';
import { useRouter } from '../../entrypoints/sidepanel/router';
import { PACKS_V3, type PackId } from '../../lib/look/packs';
import { TEMPLATES as ALL, type Template } from '../../lib/templates';
import type { ClipType } from '../../lib/types';
import { SceneThumb } from '../../screens/makeParts';
import { BackButton } from '../../screens/Setup';
import { packOf, TYPE_NAMES, TYPE_ORDER, useUseTemplate } from '../../screens/Templates';
import { TEMPLATES } from './copy';

const sel = (on: boolean) => on
  ? { border: '1px solid var(--accent)', background: 'var(--tint)', color: 'var(--accent-hover)', fontWeight: 600 }
  : { border: '1px solid var(--line)', background: 'var(--surface)', color: 'var(--ink)', fontWeight: 400 };

/** Where the v2 packs end and the four new ones begin. */
const NEW: readonly PackId[] = ['studio', 'kinetic', 'gloss', 'soft'];
const packName = (id: PackId) => PACKS_V3.find((p) => p.id === id)!.name;

/** TemplatesListV3: the ready-made clips by type and style; a tap opens your own copy. */
export default function TemplatesListV3() {
  const { back } = useRouter();
  const use = useUseTemplate();
  const [type, setType] = useState<ClipType | 'all'>('all');
  const [style, setStyle] = useState<PackId | 'any'>('any');
  const fits = (t: Template) => type === 'all' || t.type === type;
  const shown = useMemo(() => ALL.filter((t) => fits(t) && (style === 'any' || packOf(t) === style)), [type, style]);
  return (
    <main data-frame="TemplatesListV3" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', paddingBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '12px 12px 0' }}>
        <BackButton onBack={back} />
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{TEMPLATES.title}</h1>
      </div>
      <p style={{ margin: '10px 24px 0', fontSize: 12, lineHeight: 1.5, color: 'var(--muted)' }}>{TEMPLATES.line}</p>
      <div role="group" aria-label={TEMPLATES.type} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '14px 0 0', padding: '0 16px' }}>
        {([['all', 'All'], ...TYPE_ORDER.map((t) => [t, TYPE_NAMES[t]])] as [ClipType | 'all', string][]).map(([id, label]) => (
          <button key={id} type="button" aria-pressed={type === id} onClick={() => setType(id)} style={{ height: 30, padding: '0 12px', borderRadius: 999, ...sel(type === id), fontSize: 13, fontFamily: 'var(--font)', cursor: 'pointer' }}>{label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '14px 16px 0', fontSize: 12 }}>
        <span className="mono" style={{ fontWeight: 600, color: 'var(--muted)' }}>{TEMPLATES.style(style === 'any' ? TEMPLATES.any : packName(style))}</span>
        <span style={{ color: 'var(--faint)' }}>{TEMPLATES.newInV3}</span>
      </div>
      <div role="group" aria-label="Style" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '6px 16px 0' }}>
        {PACKS_V3.map((p) => {
          const on = style === p.id;
          const empty = !ALL.some((t) => fits(t) && packOf(t) === p.id);
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
        {shown.map((t) => {
          const pack = packName(packOf(t) as PackId);
          const seconds = Math.round(t.lengthMs / 1000);
          return (
            <li key={t.id}>
              <button type="button" onClick={() => use(t)} aria-label={`${t.name}, ${TYPE_NAMES[t.type]} template, ${t.scenes} scenes, ${seconds} seconds, ${pack} style. Open your own copy`}
                style={{ width: '100%', border: 0, background: 'none', padding: 0, font: 'inherit', textAlign: 'left', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: 6, cursor: 'pointer' }}>
                <span style={{ width: '100%', aspectRatio: '9 / 16', borderRadius: 14, overflow: 'hidden', display: 'block', boxShadow: '0 1px 2px rgba(16,16,20,0.06), 0 8px 20px rgba(16,16,20,0.10)' }}>
                  <SceneThumb recipe={{ ...t.recipe, aspect: '9:16' }} index={0} width={178} height={316} atMs={2200} style={{ width: '100%', height: '100%' }} />
                </span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{t.name}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{pack}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t.scenes} scenes · {seconds} s</span>
              </button>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
