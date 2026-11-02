import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../components/ui';
import { useRouter } from '../entrypoints/editor/router';
import { beatSyncEdit, bpmOf, findBeats } from '../lib/beats';
import { getMedia, putMedia } from '../lib/media';
import { useSettings } from '../lib/makeClip';
import { BUNDLED_TRACKS, bundledAssetId, chooseMusicEdit, clock, DEFAULT_MUSIC, ensureBundledAsset, fadeLabel, FADE_CHOICES, musicSettingEdit, type BundledTrack } from '../lib/music';
import { CloseIcon, DialogShell, openMediaTab, usePreview, useStoredClip } from './MediaSearch';
import { Laptop, Toggle } from './editor/dialogIcons';
import { clipDuration } from '../lib/render/drawFrame';
import { licenceName } from '../lib/media/licence';
import { getSceneTemplate } from '../lib/templates/scenes';

const row = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px' } as const;
const outline = { height: 40, borderRadius: 10, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ink)', font: '600 13px/1 var(--font)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' } as const;
const select = { height: 34, border: '1px solid var(--line-strong)', borderRadius: 8, padding: '0 6px', font: '13px var(--font)', background: 'var(--surface)', color: 'var(--ink)' } as const;

const W = 326;
const PAD = 12;
const near = (a: number, b: number) => Math.abs(a - b) <= 30;

/**
 * BeatSync's waveform over the clip: a tick at each beat (taller on the bar's first beat), the track's peaks (played
 * part darker), a tall accent marker where a cut lands on a beat, and the playhead.
 */
// A fixed ripple over the peaks, so a loud, even track still reads as a waveform; the same bar always gets the same height.
const texture = (i: number) => 0.35 + 0.65 * Math.abs(Math.sin(i * 12.9898) * 0.6 + Math.sin(i * 0.37) * 0.4);

function BeatWave({ peaks, beats, clipMs, trackMs, cuts, snapped, playMs }: { peaks: number[]; beats: number[]; clipMs: number; trackMs: number; cuts: number[]; snapped: boolean; playMs: number }) {
  const span = Math.max(1, clipMs);
  const x = (ms: number) => PAD + (Math.min(ms, span) / span) * (W - PAD * 2);
  const max = Math.max(...peaks, 0.001);
  const n = Math.floor((W - PAD * 2) / 3);
  const bars = Array.from({ length: n }, (_, i) => {
    const t = ((i + 0.5) / n) * span;
    const p = peaks.length ? (peaks[Math.min(peaks.length - 1, Math.floor((t / Math.max(trackMs, span)) * peaks.length))] ?? 0) / max : 0.6;
    return { t, h: Math.max(4, p * texture(i) * 60) };
  });
  return (
    <svg viewBox={`0 0 ${W} 96`} width="100%" height={90} role="img" aria-label="Waveform with beats and cuts" style={{ display: 'block' }}>
      {beats.filter((b) => b <= span).map((b, i) => <line key={b} x1={x(b)} x2={x(b)} y1={6} y2={i % 4 === 0 ? 18 : 14} stroke={i % 4 === 0 ? 'var(--muted)' : '#C8C8CE'} strokeWidth={1.2} />)}
      {bars.map((b, i) => <rect key={i} x={PAD + i * 3} y={56 - b.h / 2} width={2} height={b.h} rx={1} fill={b.t < playMs ? '#DB2777' : '#F9A8D4'} />)}
      {cuts.map((c) => (snapped && beats.some((b) => near(b, c))
        ? <g key={c}><line x1={x(c)} x2={x(c)} y1={22} y2={88} stroke="var(--accent)" strokeWidth={2} /><circle cx={x(c)} cy={22} r={3} fill="var(--accent)" stroke="#FFFFFF" strokeWidth={1.5} /><circle cx={x(c)} cy={88} r={3} fill="var(--accent)" stroke="#FFFFFF" strokeWidth={1.5} /></g>
        : <line key={c} x1={x(c)} x2={x(c)} y1={30} y2={82} stroke="#A1A1AA" strokeWidth={1} />))}
      <line x1={x(playMs)} x2={x(playMs)} y1={22} y2={90} stroke="var(--ink)" strokeWidth={1.5} />
      <rect x={x(playMs) - 4} y={18} width={8} height={5} rx={2.5} fill="var(--ink)" />
    </svg>
  );
}

/** How far the preview has played, while it plays. */
function usePlayed(playing: boolean): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!playing) { setMs(0); return; }
    const start = performance.now();
    let id = requestAnimationFrame(function tick() { setMs(performance.now() - start); id = requestAnimationFrame(tick); });
    return () => cancelAnimationFrame(id);
  }, [playing]);
  return ms;
}

const trackUrl = (t: BundledTrack) => browser.runtime.getURL(`/${t.file}` as '/music/upbeat.wav');

/** Music panel (BeatSync): the track now playing, mood, the beat waveform, beat sync and volume; "Change" opens the track chooser and fades. Writes Recipe.music. */
export const MOOD_CHIPS = [['upbeat', 'Upbeat'], ['calm', 'Calm'], ['warm', 'Warm'], ['dramatic', 'Dramatic'], ['none', 'No music']] as const;
const chip = (on: boolean) => ({ height: 28, padding: '0 10px', borderRadius: 14, border: on ? '1px solid var(--accent)' : '1px solid var(--line-strong)', background: on ? 'var(--tint)' : 'transparent', color: 'var(--ink)', font: '600 12px/1 var(--font)', cursor: 'pointer' }) as const;

export default function Music() {
  const { navigate, route } = useRouter();
  const { recipe, commit, close } = useStoredClip();
  const audio = usePreview();
  const [busy, setBusy] = useState(false);
  // The slider moves a local value while dragging; the clip is saved once on release.
  const [draft, setDraft] = useState<number>();
  const saving = useRef(false);
  const music = recipe?.music;
  const settings = useSettings();
  const [peaks, setPeaks] = useState<number[]>();
  const [finding, setFinding] = useState(false);
  const assetId = music?.assetId;
  const opfsPath = assetId && recipe ? recipe.assets[assetId]?.opfsPath : undefined;
  const recipeRef = useRef(recipe);
  recipeRef.current = recipe;
  // Beats are found on this computer, once per track, while the popover is open.
  useEffect(() => {
    if (!settings?.beatSync || !opfsPath) { setPeaks(undefined); return; }
    let live = true;
    setFinding(true);
    void (async () => {
      try {
        const file = await getMedia(opfsPath);
        if (!file) return;
        const found = await findBeats(file);
        if (!live) return;
        setPeaks(found.peaks);
        const r = recipeRef.current;
        const edit = r && beatSyncEdit(r, found.bpm ? found.beats : [], !!r.beatSync);
        if (edit && JSON.stringify(found.bpm ? found.beats : []) !== JSON.stringify(r?.beats)) await commit({ ...edit, summary: 'Beats found' });
      } catch (error) {
        console.error('Motikord: could not find the beats', error);
      } finally {
        if (live) setFinding(false);
      }
    })();
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.beatSync, opfsPath]);
  const [choosing, setChoosing] = useState(false);
  const bpm = bpmOf(recipe?.beats);
  const beatState = !music ? 'beats-no-music' : finding ? 'beats-finding' : bpm ? 'beats-on' : 'beats-none';
  const current = music && recipe ? recipe.assets[music.assetId] : undefined;
  const bundledId = BUNDLED_TRACKS.find((t) => bundledAssetId(t.id) === music?.assetId)?.id;
  const custom = current && !bundledId ? current : undefined;

  async function choose(t: BundledTrack | null) {
    if (!recipe || busy) return;
    setBusy(true);
    try {
      const asset = t && await ensureBundledAsset(t, { get: getMedia, put: putMedia, fetchTrack: async (x) => (await fetch(trackUrl(x))).blob() });
      const edit = chooseMusicEdit(recipe, asset);
      // A new track has its own beats; the old ones go with the change.
      if (edit && recipe.beats) edit.ops.push({ op: 'remove', path: '/beats' });
      await commit(edit);
    } catch (error) {
      console.error('Motikord: could not use this track', error);
    } finally {
      setBusy(false);
    }
  }
  const set = (field: 'volume' | 'fadeInMs' | 'fadeOutMs', value: number) => { if (recipe) void commit(musicSettingEdit(recipe, field, value)); };
  const saved = Math.round((music?.volume ?? DEFAULT_MUSIC.volume) * 100);
  const volume = draft ?? saved;
  const release = (value: number) => {
    if (saving.current || draft === undefined) return;
    saving.current = true;
    const edit = recipe && value !== saved ? musicSettingEdit(recipe, 'volume', value / 100) : undefined;
    void (edit ? commit(edit) : Promise.resolve()).finally(() => { saving.current = false; setDraft(undefined); });
  };

  const clipMs = recipe ? clipDuration(recipe) : 0;
  const nowId = bundledId ?? music?.assetId;
  const nowUrl = bundledId ? trackUrl(BUNDLED_TRACKS.find((t) => t.id === bundledId)!) : undefined;
  const played = usePlayed(!!nowId && audio.playing === nowId);
  const credit = current?.credit;
  const nowLine = current ? [credit?.author, credit ? licenceName(credit.licence) : 'Not listed', current.durationMs ? clock(current.durationMs) : undefined].filter(Boolean).join(' · ') : settings?.beatSync ? 'Add music to sync cuts to its beat.' : 'Free tracks that come with Motikord. They work offline.';
  const cuts = recipe ? recipe.scenes.reduce<number[]>((a, sc) => [...a, (a.at(-1) ?? 0) + sc.durationMs], []).slice(0, -1) : [];
  const playScene = recipe ? Math.max(0, recipe.scenes.findIndex((_, i) => played < (cuts[i] ?? Infinity))) : 0;
  const head = <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Music</h1>
    <IconButton aria-label="Close" onClick={close}><CloseIcon /></IconButton>
  </div>;

  // "Change": the track chooser, fades, and the ways to find more music.
  if (choosing) return (
    <DialogShell width={360} label="Music" style={{ padding: 16, gap: 12, overflowY: 'auto', boxShadow: '0 12px 32px rgba(16,16,20,0.12)' }}>
      {head}
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Free tracks that come with Motikord. They work offline.</span>
      <div role="radiogroup" aria-label="Music track" style={{ display: 'flex', flexDirection: 'column', flexShrink: 0, border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
        {custom && (
          <label style={{ ...row, borderBottom: '1px solid var(--line)', background: 'var(--tint)' }}>
            <input type="radio" name="m" checked readOnly style={{ accentColor: 'var(--accent)', margin: 0 }} />
            <span style={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>{custom.name}</span>
          </label>
        )}
        {BUNDLED_TRACKS.map((t) => {
          const on = bundledId === t.id;
          return (
            <label key={t.id} style={{ ...row, borderBottom: '1px solid var(--line)', background: on ? 'var(--tint)' : 'transparent' }}>
              <input type="radio" name="m" checked={on} onChange={() => void choose(t)} style={{ accentColor: 'var(--accent)', margin: 0 }} />
              <span style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{`${t.mood} · ${clock(t.durationMs)} · CC0`}</span>
              </span>
              <button type="button" aria-label={`Play ${t.name}`} onClick={(e) => { e.preventDefault(); audio.toggle(t.id, trackUrl(t)); }}
                style={{ width: 30, height: 30, border: on ? 0 : '1px solid var(--line-strong)', borderRadius: '50%', background: on ? 'var(--accent)' : 'var(--surface)', color: on ? '#fff' : 'var(--ink)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
                <PlayPause playing={audio.playing === t.id} />
              </button>
            </label>
          );
        })}
        <label style={row}>
          <input type="radio" name="m" checked={!music} onChange={() => void choose(null)} style={{ accentColor: 'var(--accent)', margin: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>No music</span>
        </label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        {([['Fade in', 'fadeInMs', DEFAULT_MUSIC.fadeInMs], ['Fade out', 'fadeOutMs', DEFAULT_MUSIC.fadeOutMs]] as const).map(([label, field, fallback]) => (
          <label key={field} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
            <select disabled={!music} value={music?.[field] ?? fallback} onChange={(e) => set(field, Number(e.target.value))} style={select}>
              {[...new Set<number>([...FADE_CHOICES, music?.[field] ?? fallback])].sort((a, b) => a - b).map((ms) => <option key={ms} value={ms}>{fadeLabel(ms)}</option>)}
            </select>
          </label>
        ))}
      </div>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>The music ends with the clip.</span>
      <div style={{ flexGrow: 1 }} />
      <button type="button" style={outline} onClick={() => { openMediaTab('audio'); navigate('MediaSearch', route.params); }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>Search free music
      </button>
      <button type="button" style={outline} onClick={() => navigate('YourMedia', route.params)}>Use your own music</button>
      <button type="button" className="btn btn-primary" onClick={() => setChoosing(false)} style={{ height: 48, borderRadius: 12, fontWeight: 600, flexShrink: 0 }}>Done</button>
    </DialogShell>
  );

  return (
    <DialogShell width={360} label="Music" style={{ padding: 16, gap: 14, overflowY: 'auto', alignSelf: 'flex-start', boxShadow: '0 12px 32px rgba(16,16,20,0.12)' }}>
      {head}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, background: 'var(--tint)', border: '1px solid var(--tint-strong)', flexShrink: 0 }}>
        {nowId && (
          <button type="button" aria-label={`${audio.playing === nowId ? 'Pause' : 'Play'} ${current?.name ?? ''}`} disabled={!nowUrl && !opfsPath}
            onClick={() => { if (nowUrl) audio.toggle(nowId, nowUrl); else if (opfsPath) void getMedia(opfsPath).then((f) => { if (f) audio.toggle(nowId, URL.createObjectURL(f)); }); }}
            style={{ width: 36, height: 36, flexShrink: 0, border: 0, borderRadius: '50%', background: 'var(--accent)', color: '#FFFFFF', display: 'grid', placeItems: 'center', cursor: 'pointer' }}>
            <PlayPause playing={audio.playing === nowId} />
          </button>
        )}
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current?.name ?? 'No music'}</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{nowLine}</span>
        </span>
        <button type="button" onClick={() => setChoosing(true)} style={{ border: 0, padding: 0, background: 'transparent', color: 'var(--accent)', font: '600 12px/1 var(--font)', cursor: 'pointer' }}>Change</button>
      </div>

      {recipe && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Mood</span>
          <div role="radiogroup" aria-label="Music mood" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {MOOD_CHIPS.map(([id, label]) => (
              <button key={id} type="button" role="radio" aria-checked={recipe.mood === id} style={chip(recipe.mood === id)}
                onClick={() => { if (recipe.mood !== id) void commit({ ops: [{ op: recipe.mood === undefined ? 'add' : 'replace', path: '/mood', value: id }], summary: 'Music mood' }); }}>{label}</button>
            ))}
          </div>
        </div>
      )}

      {settings?.beatSync && recipe && (
        <>
          {beatState === 'beats-finding' && <span role="status" style={{ fontSize: 12, color: 'var(--muted)' }}>Finding the beats…</span>}
          {beatState === 'beats-none' && <span style={{ fontSize: 12, color: 'var(--muted)' }}>No steady beat in this track, so cuts follow the pace instead.</span>}
          {music && (
            <section aria-label="Beat sync" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 0 10px', borderRadius: 12, border: '1px solid #EFEFF1', background: '#FAFAFB', flexShrink: 0 }}>
              <BeatWave peaks={peaks ?? []} beats={recipe.beats ?? []} clipMs={clipMs} trackMs={current?.durationMs ?? clipMs} cuts={cuts} snapped={!!recipe.beatSync} playMs={played % Math.max(1, clipMs)} />
              <div aria-label="Scenes" style={{ display: 'grid', gridTemplateColumns: recipe.scenes.map((sc) => `minmax(0, ${sc.durationMs}fr)`).join(' '), margin: `0 ${PAD - 1}px`, fontSize: 11, color: 'var(--muted)' }}>
                {recipe.scenes.map((sc, i) => (
                  <span key={sc.id ?? i} style={{ padding: '0 6px', borderRight: i < recipe.scenes.length - 1 ? '1px solid #F9A8D4' : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: i === playScene ? 'var(--ink)' : undefined, fontWeight: i === playScene ? 500 : undefined }}>
                    {`${i + 1} ${sc.template ? getSceneTemplate(sc.template)?.name ?? '' : ''}`.trim()}
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '2px 12px 0', fontSize: 11, color: 'var(--muted)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span aria-hidden="true" style={{ width: 1.5, height: 10, background: 'var(--muted)' }} />Beat</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)' }} />Cut snapped to beat</span>
                <span style={{ flexGrow: 1 }} />
                <span style={{ fontFamily: 'var(--mono)', color: 'var(--ink)' }}>{`0:00 – ${clock(clipMs)}`}</span>
              </div>
            </section>
          )}
          {music && bpm && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: 12, borderRadius: 12, border: '1px solid var(--line)', flexShrink: 0, cursor: 'pointer' }}>
              <span style={{ display: 'flex', flexDirection: 'column', gap: 3, flexGrow: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Beat sync</span>
                {beatState === 'beats-on' && recipe.beatSync && (
                  <span style={{ fontSize: 12, color: 'var(--success-ink)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                    Cuts land on the beat · <span style={{ fontFamily: 'var(--mono)' }}>{`${bpm} BPM`}</span>
                  </span>
                )}
              </span>
              <Toggle on={!!recipe.beatSync} label="Beat sync" onChange={(on) => { const edit = beatSyncEdit(recipe, undefined, on); if (edit) void commit(edit); }} />
            </label>
          )}
        </>
      )}

      {music && (
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}><span>Volume</span><span style={{ fontFamily: 'var(--mono)', color: 'var(--ink)' }}>{`${volume}%`}</span></span>
          <input type="range" min={0} max={100} value={volume} onChange={(e) => setDraft(Number(e.target.value))} onPointerUp={(e) => release(Number(e.currentTarget.value))} onKeyUp={(e) => release(Number(e.currentTarget.value))} onBlur={(e) => release(Number(e.currentTarget.value))} style={{ accentColor: 'var(--accent)', width: '100%', margin: 0 }} />
        </label>
      )}

      <div style={{ flexGrow: 1 }} />
      {settings?.beatSync && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: 'var(--success-ink)' }}>
          <span style={{ flexShrink: 0, marginTop: 1, display: 'flex' }}><Laptop /></span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Found on this computer. The music never leaves it.</span>
        </div>
      )}
      <button type="button" className="btn btn-primary" onClick={close} style={{ height: 48, borderRadius: 12, fontWeight: 600, flexShrink: 0 }}>Done</button>
    </DialogShell>
  );
}

const PlayPause = ({ playing }: { playing: boolean }) => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{playing ? <><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></> : <path d="M7 4v16l13-8z" />}</svg>
);
