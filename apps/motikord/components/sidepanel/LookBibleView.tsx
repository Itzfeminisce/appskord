import { useEffect, useMemo, useState } from 'react';
import type { CameraMove, Feel, LookGuide } from '@appskord/motion/types';
import { useRouter } from '../../entrypoints/sidepanel/router';
import { getBrandKit } from '../../lib/db';
import { BRAND_WINS_LOOK } from '../../lib/look/brand';
import { getPackV3 } from '../../lib/look/packs';
import type { SavedLook } from '../../lib/look/store';
import { Button } from '../ui';
import { LOOK_BIBLE } from './copy';
import { fivePalette } from './palette';
import { flow, useFlow } from './flow';

// Saved guides load when the screen needs them.
const store = () => import('../../lib/look/store');

const FEELS: Feel[] = ['smooth', 'snappy', 'bouncy', 'steady', 'floaty'];
/** The three camera habits on the frame, as the camera moves they stand for. */
const HABITS: { label: string; move: CameraMove }[] = [
  { label: LOOK_BIBLE.cameras[0], move: 'hold' },
  { label: LOOK_BIBLE.cameras[1], move: 'push-in' },
  { label: LOOK_BIBLE.cameras[2], move: 'orbit' },
];
// Off, Fine, Film as the packs' grain amounts: Fine is Medium, Film is High.
const GRAIN = [0, 0.5, 0.75];
const LIGHTS: LookGuide['light'][] = ['left', 'right', 'top', 'none'];
const LIGHT_WORDS: Record<LookGuide['light'], string> = { left: 'Light from top left', right: 'Light from top right', top: 'Light from the top', none: 'No light' };

const nearest = (v: number, steps: number[]) => steps.reduce((best, s, i) => (Math.abs(s - v) < Math.abs(steps[best]! - v) ? i : best), 0);
const habitOf = (move: CameraMove) => Math.max(0, HABITS.findIndex((h) => h.move === move));

const section = { marginTop: 12, paddingTop: 14, borderTop: '1px solid #EFEFF1', display: 'flex', flexDirection: 'column', gap: 8 } as const;
const seg = (on: boolean) => ({ height: 34, borderRadius: 7, border: 0, background: on ? '#FFFFFF' : 'transparent', boxShadow: on ? '0 1px 2px rgba(16,16,20,0.08)' : 'none', fontSize: 12, fontWeight: on ? 600 : 400, color: on ? 'var(--ink)' : 'var(--muted)', cursor: 'pointer' }) as const;
const chip = (on: boolean) => ({ height: 34, padding: '0 12px', borderRadius: 999, border: `1px solid ${on ? 'var(--accent)' : 'var(--line-input)'}`, background: on ? 'var(--tint)' : 'var(--surface)', color: on ? 'var(--accent-hover)' : 'var(--ink)', font: `${on ? 600 : 400} 13px var(--font)`, cursor: 'pointer' }) as const;

/** LookBible, "Look guide": live preview, palette, type pair, feel, light, texture and camera habit. */
export default function LookBibleView() {
  const { back } = useRouter();
  const state = useFlow();
  const [guide, setGuide] = useState<LookGuide>(() => ({ ...state.look, palette: fivePalette(state.look.palette) }));
  const [name, setName] = useState('');
  const [saved, setSaved] = useState<SavedLook[]>([]);
  const [brand, setBrand] = useState(false);
  const [glow, setGlow] = useState(() => Math.round(({ Off: 0, Low: 25, Medium: 50, High: 75, Max: 100 })[getPackV3(state.packId).finishing.glow]));
  const [softness, setSoftness] = useState(70);
  const pack = getPackV3(state.packId);
  const first = state.board?.frames[0];

  useEffect(() => {
    store().then((s) => s.listLooks()).then(setSaved).catch((error: unknown) => console.error('Motikord: could not list your look guides', error));
    getBrandKit().then((k) => setBrand(!!k)).catch(() => undefined);
  }, []);

  const set = (patch: Partial<LookGuide>) => setGuide((g) => ({ ...g, ...patch }));
  const feelLabel = LOOK_BIBLE.feels[FEELS.indexOf(guide.feel)]!;
  const grain = nearest(guide.texture, GRAIN);
  const habit = habitOf(guide.camera);
  const sceneName = first?.name ?? pack.samples[0].split(' · ')[0]!;
  const spring = guide.feel === 'bouncy' ? 'Spring · 50% bounce' : guide.feel === pack.feel ? pack.feelLabel : undefined;
  const summary = useMemo(() => `${feelLabel} · ${HABITS[habit]!.label} · ${LOOK_BIBLE.grains[grain]} grain`, [feelLabel, habit, grain]);

  const save = async () => {
    const title = name.trim() || guide.name;
    const next = { ...guide, id: `look-${Date.now().toString(36)}`, name: title };
    try {
      const { putLook, listLooks } = await store();
      await putLook({ guide: next, packId: state.packId, updatedAt: Date.now() });
      setSaved(await listLooks());
      setGuide(next);
      flow.useLook(next);
    } catch (error) { console.error('Motikord: could not save the look guide', error); }
  };

  return (
    <main data-frame="LookBible" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', paddingBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '12px 12px 0' }}>
        <button type="button" aria-label={LOOK_BIBLE.closeBack} onClick={back} className="icon-btn" style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--ink)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, flexGrow: 1 }}>{LOOK_BIBLE.title}</h1>
        <button type="button" aria-label={LOOK_BIBLE.close} onClick={back} className="icon-btn" style={{ width: 36, height: 36, borderRadius: 10, color: 'var(--ink)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
      <p style={{ margin: '4px 24px 0', fontSize: 14, color: 'var(--muted)' }}>{LOOK_BIBLE.line}</p>

      <div style={{ margin: '14px 16px 0', padding: 14, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div role="img" aria-label={`Live preview: ${sceneName}${first ? `, ${first.words}` : ''}, in the ${pack.name} look`}
          style={{ height: 150, borderRadius: 12, background: guide.palette[0], color: guide.palette[1], display: 'grid', placeItems: 'center', padding: 12, textAlign: 'center', font: `600 20px/1.1 '${guide.type.display}', sans-serif`, boxShadow: `inset 0 0 ${Math.round(glow * 0.6)}px ${guide.palette[2]}55` }}>
          {first?.words ?? guide.name}
        </div>
        <span className="mono" style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{LOOK_BIBLE.livePreview} · Scene 1</span>
        <span style={{ fontSize: 12, color: 'var(--faint)' }}>{LOOK_BIBLE.liveLine}</span>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{summary}</span>
      </div>

      <section style={{ margin: '14px 16px 0', padding: 14, borderRadius: 16, background: 'var(--surface)', border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600 }}>{LOOK_BIBLE.palette}<span style={{ fontWeight: 400, fontSize: 12, color: 'var(--muted)' }}>{LOOK_BIBLE.fromPack(pack.name)}</span></span>
        <div style={{ display: 'flex', gap: 6 }}>
          {LOOK_BIBLE.roles.map((role, i) => (
            <label key={role} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'stretch', cursor: 'pointer' }}>
              <input type="color" aria-label={`${role} colour ${guide.palette[i]}. Change`} value={guide.palette[i]!.toLowerCase()} onChange={(e) => set({ palette: guide.palette.map((c, j) => (j === i ? e.target.value.toUpperCase() : c)) })}
                style={{ width: '100%', height: 52, padding: 0, border: '1px solid var(--line-input)', borderRadius: 10, background: guide.palette[i], cursor: 'pointer' }} />
              <span style={{ fontSize: 11, textAlign: 'center', color: 'var(--muted)' }}>{role}</span>
            </label>
          ))}
        </div>

        <div style={section}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{LOOK_BIBLE.typePair}</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: 12, color: 'var(--muted)' }}>{LOOK_BIBLE.heading}</span><span style={{ fontSize: 13, fontWeight: 600 }}>{guide.type.display} {pack.fonts.display.weight}</span></span>
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column' }}><span style={{ fontSize: 12, color: 'var(--muted)' }}>{LOOK_BIBLE.body}</span><span style={{ fontSize: 13, fontWeight: 600 }}>{guide.type.text}</span></span>
          </div>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{LOOK_BIBLE.weightMoves}: {LOOK_BIBLE.weightFrom} {LOOK_BIBLE.weightLight} {LOOK_BIBLE.weightTo} {LOOK_BIBLE.weightHeavy} {LOOK_BIBLE.weightEnter}</span>
        </div>

        <div style={section}>
          <span id="feel-label" style={{ fontSize: 13, fontWeight: 600 }}>{LOOK_BIBLE.feel}</span>
          <div role="radiogroup" aria-labelledby="feel-label" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {FEELS.map((f, i) => <button key={f} type="button" role="radio" aria-checked={guide.feel === f} onClick={() => set({ feel: f })} style={chip(guide.feel === f)}>{LOOK_BIBLE.feels[i]}</button>)}
          </div>
          {spring && <span style={{ fontSize: 13 }}>{spring}</span>}
        </div>

        <div style={{ ...section, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <button type="button" aria-label={`${LIGHT_WORDS[guide.light]}. Change direction`} onClick={() => set({ light: LIGHTS[(LIGHTS.indexOf(guide.light) + 1) % LIGHTS.length]! })}
            style={{ width: 60, height: 60, flexShrink: 0, borderRadius: '50%', border: '1px solid #E0E0E4', background: 'radial-gradient(circle at 30% 30%, #FFFFFF, #E9E9EE 70%)', padding: 0, cursor: 'pointer' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexGrow: 1, minWidth: 0 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{LOOK_BIBLE.light}</span>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>{LIGHT_WORDS[guide.light]}</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 12, color: 'var(--muted)' }}>{LOOK_BIBLE.softness}</span>
              <input type="range" min={0} max={100} value={softness} onChange={(e) => setSoftness(+e.target.value)} style={{ flexGrow: 1, minWidth: 0, accentColor: 'var(--accent)' }} /></label>
          </div>
        </div>

        <div style={section}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{LOOK_BIBLE.texture}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span id="grain-label" style={{ fontSize: 13, width: 44 }}>{LOOK_BIBLE.grain}</span>
            <div role="radiogroup" aria-labelledby="grain-label" style={{ flexGrow: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, padding: 3, borderRadius: 10, background: '#F1F1F3' }}>
              {LOOK_BIBLE.grains.map((g, i) => <button key={g} type="button" role="radio" aria-checked={grain === i} onClick={() => set({ texture: GRAIN[i]! })} style={seg(grain === i)}>{g}</button>)}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 36 }}><span style={{ fontSize: 13, width: 44 }}>{LOOK_BIBLE.glow}</span>
            <input type="range" min={0} max={100} value={glow} onChange={(e) => setGlow(+e.target.value)} style={{ flexGrow: 1, minWidth: 0, accentColor: 'var(--accent)' }} />
            <span className="mono" style={{ fontSize: 12, color: 'var(--muted)', width: 32, textAlign: 'right' }}>{glow}%</span></label>
        </div>

        <div style={section}>
          <span id="camera-label" style={{ fontSize: 13, fontWeight: 600 }}>{LOOK_BIBLE.camera}</span>
          <div role="radiogroup" aria-labelledby="camera-label" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, padding: 3, borderRadius: 10, background: '#F1F1F3' }}>
            {HABITS.map((h, i) => <button key={h.label} type="button" role="radio" aria-checked={habit === i} onClick={() => set({ camera: h.move })} style={seg(habit === i)}>{h.label}</button>)}
          </div>
        </div>
        {brand && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{BRAND_WINS_LOOK}</span>}
      </section>

      <div style={{ margin: '14px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{LOOK_BIBLE.nameIt}</span>
          <input value={name} placeholder={guide.name} onChange={(e) => setName(e.target.value)} style={{ height: 40, border: '1px solid #E0E0E4', borderRadius: 10, padding: '0 12px', font: '14px var(--font)', color: 'var(--ink)', background: 'var(--surface)' }} />
        </label>
        <Button variant="secondary" block onClick={() => { void save(); }}>{LOOK_BIBLE.save}</Button>
        <Button block onClick={() => { flow.useLook(guide); back(); }}>{LOOK_BIBLE.use}</Button>
      </div>

      {saved.length > 0 && (
        <div style={{ margin: '18px 16px 0', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, padding: '0 4px' }}>{LOOK_BIBLE.yours}</span>
          {saved.map((s) => (
            <button key={s.guide.id} type="button" onClick={() => { setGuide({ ...s.guide, palette: fivePalette(s.guide.palette) }); setName(s.guide.name); }}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '10px 12px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--line)', font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{s.guide.name}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{getPackV3(s.packId).name} · {LOOK_BIBLE.feels[FEELS.indexOf(s.guide.feel)]}</span>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}
