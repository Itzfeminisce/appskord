import { useEffect, useState } from 'react';
import { guessType } from '../lib/ai/detectType';
import { getBrandKit } from '../lib/db';
import { draft, useDraft, useSettings } from '../lib/makeClip';
import { updateSettings } from '../lib/settings';
import { paceMs } from '../lib/templates/pick';
import { autoStyle, getPack, STYLE_PACKS } from '../lib/templates/scenes';
import type { ClipType, LookStyle, Mood, Pace, Settings, StyleId } from '../lib/types';
import { useRouter } from '../entrypoints/sidepanel/router';
import { TYPE_NAMES } from './Templates';

type Look = Settings['look'];

export const STYLE_LABEL: Record<LookStyle, string> = { auto: 'Auto', clean: 'Clean', bold: 'Bold', playful: 'Playful', corporate: 'Corporate' };
export const PACE_LABEL: Record<Pace, string> = { calm: 'Calm', normal: 'Normal', fast: 'Fast' };
export const MOOD_LABEL: Record<Mood, string> = { upbeat: 'Upbeat', calm: 'Calm', warm: 'Warm', dramatic: 'Dramatic', none: 'No music' };
const PACES: Pace[] = ['calm', 'normal', 'fast'];
const MOODS: Mood[] = ['upbeat', 'calm', 'warm', 'dramatic', 'none'];

/** The Look row's value: "Auto style · Normal pace · Upbeat". */
export const lookLine = (l: Look) => `${STYLE_LABEL[l.style]} style · ${PACE_LABEL[l.pace]} pace · ${MOOD_LABEL[l.mood]}`;
/** "About 3 s a scene", changing with pace. */
export const paceHint = (pace: Pace) => `About ${+(paceMs(pace).sceneMs / 1000).toFixed(2)} s a scene`;

const save = (patch: Parameters<typeof updateSettings>[0]) => { updateSettings(patch).catch((error: unknown) => console.error('Motikord: could not save settings', error)); };

/** On: the look becomes the saved default and the clip's own copy goes. Off: only the draft carries it. */
export function applyLook(next: Look, always: boolean) {
  if (always) { save({ look: next }); draft.set({ look: undefined }); }
  else draft.set({ look: next });
}

const checkIcon = (size: number, stroke: string, width = 2.8) => <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
const chipStyle = (on: boolean) => ({
  height: 36, padding: on ? '0 12px 0 10px' : '0 14px', borderRadius: 999, border: `1px solid ${on ? 'var(--accent)' : 'var(--line-input)'}`,
  background: on ? 'var(--tint)' : 'var(--surface)', color: on ? 'var(--accent-hover)' : 'var(--ink)', font: `${on ? 600 : 400} 13px var(--font)`,
  display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
}) as const;
const sample = { title: 'Fresh sourdough', line: 'Baked at 5am' };

/** A pack's large preview on its card, drawn in the pack's colours and fonts. */
export function PackPreview({ id }: { id: StyleId }) {
  const pack = getPack(id);
  if (!pack) return null;
  const { palette: p, fonts } = pack;
  const box = { height: 92, borderRadius: 8, boxSizing: 'border-box', overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' } as const;
  if (id === 'bold') return (
    <span aria-hidden="true" style={{ ...box, background: p.bg, justifyContent: 'space-between', paddingTop: 12 }}>
      <span style={{ padding: '0 12px', font: `15px/1.05 '${fonts.display}', sans-serif`, color: p.ink, textTransform: 'uppercase' }}>Fresh<br /><span style={{ background: p.accent, color: p.bg, padding: '0 3px' }}>sourdough</span></span>
      <span style={{ height: 22, background: p.accent, padding: '0 12px', display: 'flex', alignItems: 'center', font: `10px '${fonts.text}', sans-serif`, color: p.bg }}>{sample.line}</span>
    </span>
  );
  if (id === 'playful') return (
    <span aria-hidden="true" style={{ ...box, background: p.bg, justifyContent: 'center', padding: 12, gap: 6 }}>
      <span style={{ position: 'absolute', top: -18, right: -14, width: 62, height: 54, borderRadius: '50% 40% 55% 45%', background: '#FDBA74' }} />
      <span style={{ position: 'absolute', bottom: -16, right: 34, width: 34, height: 30, borderRadius: '45% 55% 40% 60%', background: '#5EEAD4' }} />
      <span style={{ position: 'relative', font: `600 16px/1.05 '${fonts.display}', sans-serif`, color: p.ink }}>{sample.title}</span>
      <span style={{ position: 'relative', alignSelf: 'flex-start', font: `10px '${fonts.text}', sans-serif`, color: '#fff', background: '#0F766E', padding: '2px 7px', borderRadius: 999 }}>{sample.line}</span>
    </span>
  );
  if (id === 'corporate') return (
    <span aria-hidden="true" style={{ ...box, background: `radial-gradient(120% 90% at 100% 0%, #1A3D66, ${p.bg} 60%)`, justifyContent: 'center', padding: 12, gap: 6 }}>
      <span style={{ font: `600 16px/1.1 '${fonts.display}', serif`, color: p.ink }}>{sample.title}</span>
      <span style={{ width: 22, height: 2, background: p.accent }} />
      <span style={{ font: `10px '${fonts.text}', sans-serif`, color: '#CBD5E1' }}>{sample.line}</span>
    </span>
  );
  return (
    <span aria-hidden="true" style={{ ...box, background: `linear-gradient(160deg, ${p.bg} 30%, ${p.bg2})`, border: '1px solid #E2E8F0', justifyContent: 'center', padding: 12, gap: 5 }}>
      <span style={{ width: 20, height: 3, borderRadius: 2, background: p.accent }} />
      <span style={{ font: `700 15px/1.1 '${fonts.display}', sans-serif`, letterSpacing: '-0.02em', color: p.ink }}>{sample.title}</span>
      <span style={{ font: `10px '${fonts.text}', sans-serif`, color: '#475569' }}>{sample.line}</span>
    </span>
  );
}

function Label({ children, id }: { children: string; id: string }) {
  return <span id={id} style={{ fontSize: 13, fontWeight: 600 }}>{children}</span>;
}

/** A pink switch over a real checkbox. */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label?: string }) {
  return (
    <>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ position: 'absolute', opacity: 0, width: 1, height: 1, margin: 0 }} />
      <span aria-hidden="true" style={{ width: 40, height: 24, borderRadius: 999, background: checked ? 'var(--accent)' : '#C4C4CA', position: 'relative', flexShrink: 0, transition: 'background-color 120ms' }}>
        <span style={{ position: 'absolute', top: 3, left: checked ? 19 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', boxShadow: '0 1px 2px rgba(16,16,20,0.2)', transition: 'left 120ms' }} />
      </span>
    </>
  );
}

/** The sheet over Home: style, pace and music mood for the next clip. */
export default function LookSheet() {
  const { back } = useRouter();
  const d = useDraft();
  const settings = useSettings();
  const [always, setAlways] = useState(false);
  const [brand, setBrand] = useState(false);
  useEffect(() => {
    getBrandKit().then((k) => setBrand(!!k?.useForNewClips)).catch((error: unknown) => console.error('Motikord: could not read the brand kit', error));
  }, []);
  // Opening the sheet answers the New card.
  useEffect(() => { save({ lookCardSeen: true }); }, []);

  const look: Look = d.look ?? settings?.look ?? { style: 'auto', pace: 'normal', mood: 'upbeat' };
  const type: ClipType = d.type ?? settings?.defaultType ?? guessType(d.prompt);
  const pick = autoStyle(type);
  const change = (patch: Partial<Look>) => applyLook({ ...look, ...patch }, always);
  const toggle = (on: boolean) => {
    setAlways(on);
    if (on) applyLook(look, true);
  };

  const radio = (on: boolean) => (
    <span style={{ width: 14, height: 14, borderRadius: '50%', border: on ? '4px solid var(--accent)' : '1.5px solid #C4C4CA', boxSizing: 'border-box', flexShrink: 0 }} />
  );
  const auto = look.style === 'auto';

  return (
    <main data-frame="LookSheet" style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(17,17,20,0.48)' }}>
      <button type="button" aria-label="Close and go back" onClick={back} style={{ flexGrow: 1, minHeight: 40, border: 0, background: 'none', cursor: 'default' }} />
      <section role="dialog" aria-modal="true" aria-labelledby="look-title" style={{ borderRadius: '20px 20px 0 0', background: 'var(--surface)', boxShadow: '0 -12px 40px rgba(16,16,20,0.18)', padding: '8px 20px 20px', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 40px)', overflowY: 'auto' }}>
        <span aria-hidden="true" style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, background: '#DCDCE0', flexShrink: 0 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12 }}>
          <h2 id="look-title" style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: '-0.015em', flexGrow: 1 }}>Choose the look</h2>
          <button type="button" aria-label="Close" onClick={back} style={{ width: 40, height: 40, border: 0, borderRadius: 10, background: '#F4F4F5', color: 'var(--ink)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div role="radiogroup" aria-labelledby="style-label" style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Label id="style-label">Style</Label>
          <div role="radio" aria-checked={auto} tabIndex={0} onClick={() => change({ style: 'auto' })} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); change({ style: 'auto' }); } }}
            style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: auto ? '12px 14px' : '13px 15px', borderRadius: 14, border: auto ? '2px solid var(--accent)' : '1px solid var(--line)', background: auto ? 'var(--tint)' : 'var(--surface)', cursor: 'pointer' }}>
            <span style={{ width: 36, height: 36, borderRadius: 10, background: auto ? 'var(--surface)' : 'var(--tint)', color: 'var(--accent)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Auto</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Picked by clip type</span>
            </span>
            <span style={{ height: 26, padding: '0 10px', borderRadius: 999, background: 'var(--surface)', border: '1px solid #F9A8D4', fontSize: 12, fontWeight: 500, color: 'var(--accent-hover)', display: 'flex', alignItems: 'center', gap: 6, marginRight: 18 }}>
              {TYPE_NAMES[type]}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>{STYLE_LABEL[pick]}
            </span>
            {auto && <span style={{ position: 'absolute', top: 8, right: 8, width: 18, height: 18, borderRadius: '50%', background: 'var(--accent)', display: 'grid', placeItems: 'center' }}>{checkIcon(11, '#fff', 3)}</span>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            {STYLE_PACKS.map(({ id }) => {
              const on = look.style === id;
              return (
                <div key={id} role="radio" aria-checked={on} aria-label={STYLE_LABEL[id]} tabIndex={0} onClick={() => change({ style: id })} onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); change({ style: id }); } }}
                  style={{ display: 'flex', flexDirection: 'column', gap: 7, padding: on ? '5px 5px 7px' : '6px 6px 8px', borderRadius: 12, border: on ? '2px solid var(--accent)' : id === pick ? '1px dashed #F9A8D4' : '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer' }}>
                  <PackPreview id={id} />
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px' }}>
                    {radio(on)}
                    <span style={{ fontSize: 13, fontWeight: 500, flexGrow: 1 }}>{STYLE_LABEL[id]}</span>
                    {id === pick && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-hover)', background: 'var(--tint-strong)', padding: '1px 6px', borderRadius: 999 }}>Auto pick</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Label id="pace-label">Pace</Label>
          <div role="radiogroup" aria-labelledby="pace-label" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 2, padding: 3, borderRadius: 11, background: '#F1F1F3' }}>
            {PACES.map((p) => {
              const on = look.pace === p;
              return <button key={p} type="button" role="radio" aria-checked={on} onClick={() => change({ pace: p })} style={{ height: 38, border: 0, borderRadius: 8, background: on ? 'var(--surface)' : 'transparent', boxShadow: on ? '0 1px 2px rgba(16,16,20,0.1)' : 'none', font: `${on ? 600 : 400} 13px var(--font)`, color: on ? 'var(--ink)' : 'var(--muted)', cursor: 'pointer' }}>{PACE_LABEL[p]}</button>;
            })}
          </div>
          <span style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            {paceHint(look.pace)}
          </span>
        </div>

        <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Label id="music-label">Music mood</Label>
          <div role="radiogroup" aria-labelledby="music-label" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {MOODS.map((m) => <button key={m} type="button" role="radio" aria-checked={look.mood === m} onClick={() => change({ mood: m })} style={chipStyle(look.mood === m)}>{look.mood === m && checkIcon(13, 'currentColor')}{MOOD_LABEL[m]}</button>)}
          </div>
        </div>

        {brand && (
          <div style={{ marginTop: 18, padding: '10px 12px', borderRadius: 10, background: '#F4F4F5', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
            <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--muted)' }}>Your brand kit is on: its colours, fonts and logo replace the pack's.</span>
          </div>
        )}

        <label style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, padding: '4px 0', cursor: 'pointer', position: 'relative' }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>Use for every new clip</span>
            <span style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--muted)' }}>Off: this clip only. On: it becomes your default in Settings.</span>
          </span>
          <Switch checked={always} onChange={toggle} />
        </label>
        <div style={{ flexGrow: 1, minHeight: 12 }} />
        <button type="button" onClick={back} className="btn btn-primary btn-block btn-tall">Done</button>
      </section>
    </main>
  );
}
