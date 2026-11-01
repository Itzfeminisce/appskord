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

const chipStyle = (on: boolean) => ({ height: 34, padding: '0 14px', borderRadius: 999, border: on ? 0 : '1px solid #E0E0E4', background: on ? 'var(--ink)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink)', font: `${on ? 500 : 400} 13px var(--font)`, cursor: 'pointer' }) as const;

/** A small scene drawn in a pack's colours and fonts. */
export function PackPreview({ id }: { id: StyleId }) {
  const pack = getPack(id);
  if (!pack) return null;
  const { palette: p, fonts } = pack;
  return (
    <span aria-hidden="true" style={{ width: 44, height: 64, flexShrink: 0, borderRadius: 8, background: `linear-gradient(160deg, ${p.bg}, ${p.bg2})`, border: '1px solid var(--line)', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3, padding: 5, boxSizing: 'border-box', overflow: 'hidden' }}>
      <span style={{ font: `700 10px/1.05 '${fonts.display}', var(--font)`, color: p.ink }}>Fresh sourdough</span>
      <span style={{ font: `400 6px/1.2 '${fonts.text}', var(--font)`, color: p.muted }}>Baked at 5am</span>
      <span style={{ width: 14, height: 3, borderRadius: 2, background: p.accent }} />
    </span>
  );
}

function Label({ children }: { children: string }) {
  return <span style={{ fontSize: 13, fontWeight: 600, padding: '0 8px' }}>{children}</span>;
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
  const styles: LookStyle[] = ['auto', ...STYLE_PACKS.map((p) => p.id)];

  return (
    <main data-frame="LookSheet" style={{ position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(17,17,20,0.45)' }}>
      <button type="button" aria-label="Close" onClick={back} style={{ flexGrow: 1, border: 0, background: 'none', cursor: 'default' }} />
      <div role="dialog" aria-label="Choose the look" style={{ borderRadius: '20px 20px 0 0', background: 'var(--surface)', padding: '10px 16px 20px', display: 'flex', flexDirection: 'column', gap: 12, maxHeight: '92vh', overflowY: 'auto' }}>
        <span style={{ alignSelf: 'center', width: 36, height: 4, borderRadius: 2, background: '#DCDCE0', flexShrink: 0 }} />
        <h1 style={{ margin: 0, padding: '4px 8px 0', fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>Choose the look</h1>

        <Label>Style</Label>
        <div role="radiogroup" aria-label="Style" style={{ display: 'flex', flexDirection: 'column' }}>
          {styles.map((s) => (
            <label key={s} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '8px', borderRadius: 12, background: look.style === s ? 'var(--tint)' : 'transparent', cursor: 'pointer' }}>
              <input type="radio" name="style" checked={look.style === s} onChange={() => change({ style: s })} style={{ accentColor: 'var(--accent)', width: 16, height: 16, margin: 0 }} />
              <PackPreview id={s === 'auto' ? pick : s} />
              <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flexGrow: 1 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{STYLE_LABEL[s]}</span>
                {s === 'auto' && <span style={{ fontSize: 12, color: 'var(--muted)' }}>Picked by clip type</span>}
                {s === 'auto' && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{TYPE_NAMES[type]} → {STYLE_LABEL[pick]}</span>}
              </span>
              {s === pick && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-hover)', background: 'var(--tint-strong)', padding: '2px 8px', borderRadius: 999 }}>Auto pick</span>}
            </label>
          ))}
        </div>

        <Label>Pace</Label>
        <div role="radiogroup" aria-label="Pace" style={{ display: 'flex', gap: 6, padding: '0 8px' }}>
          {PACES.map((p) => <button key={p} type="button" role="radio" aria-checked={look.pace === p} onClick={() => change({ pace: p })} style={chipStyle(look.pace === p)}>{PACE_LABEL[p]}</button>)}
        </div>
        <span style={{ fontSize: 12, color: 'var(--muted)', padding: '0 8px' }}>{paceHint(look.pace)}</span>

        <Label>Music mood</Label>
        <div role="radiogroup" aria-label="Music mood" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 8px' }}>
          {MOODS.map((m) => <button key={m} type="button" role="radio" aria-checked={look.mood === m} onClick={() => change({ mood: m })} style={chipStyle(look.mood === m)}>{MOOD_LABEL[m]}</button>)}
        </div>

        {brand && <span style={{ fontSize: 12, color: 'var(--muted)', padding: '0 8px' }}>Your brand kit is on: its colours, fonts and logo replace the pack's.</span>}

        <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 8px 4px', borderTop: '1px solid #EFEFF1', cursor: 'pointer' }}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flexGrow: 1 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Use for every new clip</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Off: this clip only. On: it becomes your default in Settings.</span>
          </span>
          <input type="checkbox" role="switch" checked={always} onChange={(e) => toggle(e.target.checked)} style={{ width: 36, height: 20, accentColor: 'var(--accent)', margin: 0 }} />
        </label>
        <button type="button" onClick={back} className="btn btn-primary btn-block">Done</button>
      </div>
    </main>
  );
}
