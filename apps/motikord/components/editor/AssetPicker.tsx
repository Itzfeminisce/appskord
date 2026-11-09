import { useState } from 'react';
import type { LayerV3 } from '@appskord/motion/types';
import { moveTracks } from '../../lib/templates/v3/build';
import { useEditorV3 } from './context';
import { entranceMs } from './edits';
import { editLayer, editScene } from './model';
import { C, hint, PanelHead, Section, Segmented, Slider, SwitchRow } from './ui';

// AssetPicker: animations, icons and stickers bundled with Motikord, each with its credit. Nothing is downloaded.

export type AssetKind = 'animation' | 'icon' | 'sticker';
export interface BundledAsset {
  id: string;
  kind: AssetKind;
  name: string;
  author: string;
  /** "LottieFiles licence". */
  licence: string;
  /** Extension path of the bundled file. */
  file: string;
}

/** The bundled catalog. Empty until the credited files ship (see the T9 report). */
export const BUNDLED_ASSETS: readonly BundledAsset[] = [];

const TABS: readonly [AssetKind, string][] = [
  ['animation', 'Animations'],
  ['icon', 'Icons'],
  ['sticker', 'Stickers'],
];
const KIND_LINE: Record<AssetKind, string> = { animation: 'Animation', icon: 'Icon', sticker: 'Sticker' };
const LAYER_KIND: Record<AssetKind, LayerV3['kind']> = { animation: 'lottie', icon: 'icon', sticker: 'icon' };
/** The slot id an added asset's layer carries, naming its bundled file. */
const SLOT = 'asset:';

export const credit = (a: BundledAsset) => `by ${a.author} · ${a.licence}`;

export function assetOf(layer: LayerV3, catalog: readonly BundledAsset[] = BUNDLED_ASSETS): BundledAsset | undefined {
  const id = layer.slotId?.startsWith(SLOT) ? layer.slotId.slice(SLOT.length) : undefined;
  return id ? catalog.find((a) => a.id === id) : undefined;
}

/** A new layer for a bundled asset: front, fading in at the scene's start. */
export function assetLayer(a: BundledAsset, taken: ReadonlySet<string>): LayerV3 {
  let n = 1;
  while (taken.has(`${a.id}-${n}`)) n++;
  return { id: `${a.id}-${n}`, kind: LAYER_KIND[a.kind], depth: 'front', start: 0, slotId: `${SLOT}${a.id}`, tracks: moveTracks('fade', 400, { kind: 'bezier', p: [0.22, 1, 0.36, 1] }) };
}

export function AssetPicker({ catalog = BUNDLED_ASSETS }: { catalog?: readonly BundledAsset[] }) {
  const ed = useEditorV3();
  const [tab, setTab] = useState<AssetKind>('animation');
  const [query, setQuery] = useState('');
  const added = new Set(ed.scene.layers.flatMap((l) => (l.slotId?.startsWith(SLOT) ? [l.slotId.slice(SLOT.length)] : [])));
  const shown = catalog.filter((a) => a.kind === tab && a.name.toLowerCase().includes(query.trim().toLowerCase()));
  const add = (a: BundledAsset) =>
    ed.update((st) => {
      let id = '';
      const next = editScene(st, st.scene, (s) => {
        const l = assetLayer(a, new Set(s.layers.map((x) => x.id)));
        id = l.id;
        s.layers.push(l);
      }, { summary: `${a.name} added to scene ${st.scene + 1}` });
      return next === st ? st : { ...next, layerId: id, tab: 'layer' };
    });
  return (
    <section aria-label="Add" style={{ width: 320, flexShrink: 0, background: C.surface, borderRight: '1px solid #E8E8EB', display: 'flex', flexDirection: 'column', padding: '12px 16px', gap: 9, boxSizing: 'border-box', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 15, fontWeight: 600 }}>Add</span>
        <button type="button" aria-label="Close Add" onClick={() => ed.setOverlay(undefined)} style={{ width: 28, height: 28, border: 0, borderRadius: 7, background: 'transparent', cursor: 'pointer' }}>×</button>
      </div>
      <div role="tablist" aria-label="What to add" style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 9, background: C.stage }}>
        {TABS.map(([id, text]) => (
          <button key={id} type="button" role="tab" aria-selected={id === tab} onClick={() => { setTab(id); setQuery(''); }}
            style={{ flex: 1, height: 28, border: 0, borderRadius: 6, background: id === tab ? C.surface : 'transparent', font: `${id === tab ? 600 : 400} 12px/1 inherit`, color: id === tab ? C.ink : C.muted, cursor: 'pointer' }}>
            {text}
          </button>
        ))}
      </div>
      {tab === 'animation' && (
        <input aria-label="Search animations" placeholder="Search animations" value={query} onChange={(e) => setQuery(e.currentTarget.value)}
          style={{ height: 32, border: '1px solid #E0E0E4', borderRadius: 8, padding: '0 10px', font: '400 13px/1 inherit' }} />
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {shown.map((a) => (
          <button key={a.id} type="button" aria-label={`${a.name}, ${credit(a)}`} title={credit(a)} onClick={() => add(a)}
            style={{ position: 'relative', aspectRatio: '1', border: `1px solid ${added.has(a.id) ? '#FBCFE8' : '#E8E8EB'}`, borderRadius: 10, background: added.has(a.id) ? C.tint : C.surface, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: 6, font: '500 11px/1.2 inherit', cursor: 'pointer' }}>
            {added.has(a.id) && <span style={{ position: 'absolute', top: 4, right: 4, fontSize: 10, color: C.accent, fontWeight: 600 }}>Added</span>}
            {a.name}
          </button>
        ))}
      </div>
      <p style={{ ...hint, margin: 0 }}>
        Bundled with Motikord. Nothing is downloaded. Each one’s credit goes in <span style={{ color: C.accent }}>Credits</span>.
      </p>
    </section>
  );
}

/** The Layer tab for an added asset: when it plays, its size and its credit. */
export function AssetDetails({ layer, catalog = BUNDLED_ASSETS }: { layer: LayerV3; catalog?: readonly BundledAsset[] }) {
  const ed = useEditorV3();
  const a = assetOf(layer, catalog);
  if (!a) return null;
  const words = ed.scene.layers.find((l) => l.kind === 'text');
  const lands = words ? (words.start ?? 0) + entranceMs(words) : 0;
  const plays = (layer.start ?? 0) > 0 ? 'lands' : 'start';
  const size = Math.round((layer.tracks.scale?.[layer.tracks.scale.length - 1]?.v ?? 1) * 96);
  return (
    <>
      <PanelHead icon="✦" name={a.name} line={`${KIND_LINE[a.kind]} · scene ${ed.state.scene + 1}`} />
      <Section title="Plays">
        <Segmented name="Plays" options={[['lands', 'When the headline lands'], ['start', 'At scene start']] as const} value={plays}
          onChange={(v) => ed.update((st) => editLayer(st, layer.id, (l) => { l.start = v === 'lands' ? Math.round(lands) : 0; }, { summary: `${a.name}: ${v === 'lands' ? 'When the headline lands' : 'At scene start'}` }))} />
        <Slider name="Size" min={24} max={480} step={8} value={size} text={`${size} px`}
          onChange={(v) => ed.update((st) => editLayer(st, layer.id, (l) => { l.tracks.scale = [{ t: 0, v: Math.round((v / 96) * 100) / 100 }]; }, { summary: `${a.name}: Size ${v} px`, mergeKey: `${layer.id}:size` }))} />
        {/* Speed, loop and colour have no recipe field yet. */}
        <Slider name="Speed" min={0.5} max={2} step={0.1} value={1} text="1.0×" disabled onChange={() => undefined} />
        <SwitchRow title="Loop" on={false} disabled onChange={() => undefined} />
        <SwitchRow title="Colour from look guide" on disabled onChange={() => undefined} />
      </Section>
      <p style={{ ...hint, margin: '4px 0 0' }}>{credit(a)}</p>
      <p style={{ ...hint, margin: 0 }}>Listed in <span style={{ color: C.accent }}>Credits</span> on export.</p>
    </>
  );
}
