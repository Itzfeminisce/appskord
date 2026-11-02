import { useState } from 'react';
import { TRACKS } from '@/lib/audio/tracks';
import { setAudio } from '@/lib/project/ops';
import type { AudioMix } from '@/lib/project/types';
import type { SlotProps } from '../components/slots';
import { AddMedia } from '../dialogs/AddMedia';
import { FADE_MS, MusicPicker } from '../dialogs/MusicPicker';
import { clock } from '../format';
import { useLoudness } from '../hooks/useAudio';
import { Heading, Seg, Slider, Switch } from '../timeline/controls';
import { C, Icon, MONO } from '../ui';

type Music = NonNullable<AudioMix['music']>;
type Volume = 'tabVolume' | 'music';
const FADES = [{ value: 'none', label: 'No fade' }, { value: 'both', label: 'Fade both' }] as const;

/** The meter's scale, LUFS: -16 fills 70%, as in the frame. */
const METER = { low: -40, high: -6 };
export const meterShare = (lufs: number) => Math.max(0, Math.min(1, (lufs - METER.low) / (METER.high - METER.low)));
/** "−16 LUFS", with the frame's minus sign. */
export const lufsText = (lufs: number) => `${Math.round(lufs)} LUFS`.replace('-', '−');
const pct = (v: number) => `${Math.round(v * 100)}%`;

/** "Bundled · CC0 · 2:30, loops": where the music comes from, its length, and whether it repeats to fill the cut. */
export function musicLine(name: string | undefined, duration: number, cutMs: number): string {
  const length = `${clock(duration)}${duration < cutMs ? ', loops' : ''}`;
  return TRACKS.some((t) => t.name === name) ? `Bundled · CC0 · ${length}` : length;
}

/** The Audio tab: the voice's noise removal and loudness, the music bed, and the tab sound. */
export function AudioPanel(p: SlotProps) {
  const { project, cut, readOnly, edit, length } = p;
  const audio = cut.audio;
  const music = audio.music;
  const source = music && project.sources.find((s) => s.id === music.source);
  const lufs = useLoudness();
  const [draft, setDraft] = useState<Partial<Record<Volume, number>>>({});
  const [dialog, setDialog] = useState<'music' | 'own' | null>(null);
  const hasVoice = project.sources.some((s) => s.audio && (s.kind === 'mic' || s.kind === 'baked'));
  const hasTab = project.sources.some((s) => s.audio && s.kind === 'tab');

  const set = (patch: Partial<AudioMix>) => !readOnly && edit((q) => setAudio(q, { patch }));
  const setMusic = (patch: Partial<Music>) => music && set({ music: { ...music, ...patch } });
  const shown = (key: Volume) => draft[key] ?? (key === 'music' ? (music?.volume ?? 0) : audio[key]);
  const commit = (key: Volume, v: number) => {
    setDraft((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });
    if (key === 'music') { if (music && v !== music.volume) setMusic({ volume: v }); }
    else if (v !== audio[key]) set({ [key]: v });
  };
  const volume = (key: Volume) => (
    <Slider label="Volume" min={0} max={1} step={0.01} value={shown(key)} text={pct(shown(key))} disabled={readOnly}
      onInput={(v) => !readOnly && setDraft((d) => ({ ...d, [key]: v }))} onCommit={(v) => commit(key, v)} />
  );
  const fade = music ? (music.fadeIn === 0 && music.fadeOut === 0 ? 'none' : music.fadeIn > 0 && music.fadeOut > 0 ? 'both' : undefined) : undefined;

  return (
    <>
      {hasVoice && (
        <>
          <Heading>Your voice</Heading>
          <Switch label="Remove background noise" sub="Fans, keyboards and hum." on={audio.denoise} disabled={readOnly} onChange={(denoise) => set({ denoise })} />
          <Switch label="Even out the loudness" sub="Quiet and loud parts end up the same." on={audio.level} disabled={readOnly} onChange={(level) => set({ level })} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: C.secondary, width: 74, flexShrink: 0 }}>Loudness</span>
            <span role="meter" aria-label="Loudness" aria-valuemin={METER.low} aria-valuemax={METER.high} aria-valuenow={lufs ?? undefined}
              style={{ flexGrow: 1, height: 6, borderRadius: 3, background: C.line, position: 'relative' }}>
              {lufs !== null && <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${meterShare(lufs) * 100}%`, borderRadius: 3, background: C.ok }} />}
            </span>
            <span style={{ fontFamily: MONO, fontSize: 11, width: 52, textAlign: 'right' }}>{lufs !== null ? lufsText(lufs) : ''}</span>
          </div>
        </>
      )}

      <Heading>Music</Heading>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, background: C.raised, border: `1px solid ${C.line}` }}>
        <span style={{ color: '#93C5FD', display: 'flex' }}>
          <Icon><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></Icon>
        </span>
        <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <span style={{ fontSize: 12.5, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{source ? (source.name ?? source.file) : 'No music'}</span>
          {source && <span style={{ fontSize: 11, color: C.muted }}>{musicLine(source.name, source.duration, length)}</span>}
        </span>
        <button type="button" disabled={readOnly} onClick={() => setDialog('music')}
          style={{ height: 28, padding: '0 12px', borderRadius: 8, border: 0, background: 'transparent', color: C.secondary, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', cursor: readOnly ? 'default' : 'pointer' }}>
          <span>Change</span>
        </button>
      </div>
      {music && (
        <>
          {volume('music')}
          <Switch label="Lower music while you talk" on={music.duck} disabled={readOnly} onChange={(duck) => setMusic({ duck })} />
          <Seg label="Fades" options={FADES} value={fade} disabled={readOnly}
            onChange={(f) => f !== fade && setMusic(f === 'none' ? { fadeIn: 0, fadeOut: 0 } : { fadeIn: FADE_MS, fadeOut: FADE_MS })} />
        </>
      )}

      {hasTab && (
        <>
          <Heading>Tab sound</Heading>
          {volume('tabVolume')}
        </>
      )}

      {dialog === 'music' && <MusicPicker p={p} onClose={() => setDialog(null)} onOwnFile={() => setDialog('own')} />}
      {dialog === 'own' && <AddMedia p={p} start="music" onClose={() => setDialog(null)} />}
    </>
  );
}
