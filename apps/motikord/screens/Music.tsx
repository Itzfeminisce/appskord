import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../components/ui';
import { useRouter } from '../entrypoints/editor/router';
import { beatSyncEdit, bpmOf, findBeats } from '../lib/beats';
import { getMedia, putMedia } from '../lib/media';
import { useSettings } from '../lib/makeClip';
import { BUNDLED_TRACKS, bundledAssetId, chooseMusicEdit, clock, DEFAULT_MUSIC, ensureBundledAsset, fadeLabel, FADE_CHOICES, musicSettingEdit, type BundledTrack } from '../lib/music';
import { CloseIcon, DialogShell, openMediaTab, usePreview, useStoredClip } from './MediaSearch';

const row = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px' } as const;
const outline = { height: 40, borderRadius: 10, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ink)', font: '600 13px/1 var(--font)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' } as const;
const select = { height: 34, border: '1px solid var(--line-strong)', borderRadius: 8, padding: '0 6px', font: '13px var(--font)', background: 'var(--surface)', color: 'var(--ink)' } as const;

/** Waveform with a tick at each beat and a mark where a cut was snapped to one. */
function Wave({ peaks, beats, total, cuts }: { peaks: number[]; beats: number[]; total: number; cuts: number[] }) {
  const max = Math.max(...peaks, 0.001);
  const x = (ms: number) => (ms / total) * 300;
  return (
    <svg viewBox="0 0 300 48" width="100%" height={48} role="img" aria-label="Waveform with beats">
      {peaks.map((p, i) => <rect key={i} x={i * 2.5} y={24 - (p / max) * 22} width={1.8} height={Math.max(1, (p / max) * 44)} fill="var(--muted)" opacity={0.5} />)}
      {beats.map((b) => <line key={b} x1={x(b)} x2={x(b)} y1={0} y2={48} stroke="var(--accent)" strokeWidth={0.6} />)}
      {cuts.filter((c) => beats.includes(c)).map((c) => <circle key={c} cx={x(c)} cy={4} r={3} fill="var(--accent)" />)}
    </svg>
  );
}

const trackUrl = (t: BundledTrack) => browser.runtime.getURL(`/${t.file}` as '/music/upbeat.wav');

/** Music panel: the bundled CC0 tracks, volume and fades. Writes Recipe.music. */
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
        const edit = r && beatSyncEdit(r, found.bpm ? found.beats : [], !!r.beatSync && !!found.bpm);
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
  const chooser = useRef<HTMLDivElement>(null);
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

  return (
    <DialogShell width={360} label="Music" style={{ padding: 16, gap: 12, overflowY: 'auto', boxShadow: '0 12px 32px rgba(16,16,20,0.12)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Music</h1>
        <IconButton aria-label="Close" onClick={close}><CloseIcon /></IconButton>
      </div>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Free tracks that come with Motikord. They work offline.</span>

      <div ref={chooser} role="radiogroup" aria-label="Music track" style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
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
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{audio.playing === t.id ? <path d="M6 4h4v16H6zM14 4h4v16h-4z" /> : <path d="M7 4v16l13-8z" />}</svg>
              </button>
            </label>
          );
        })}
        <label style={row}>
          <input type="radio" name="m" checked={!music} onChange={() => void choose(null)} style={{ accentColor: 'var(--accent)', margin: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, flexGrow: 1 }}>No music</span>
        </label>
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}><span>Volume</span><span style={{ fontFamily: 'var(--mono)', color: 'var(--ink)' }}>{`${volume}%`}</span></span>
        <input type="range" min={0} max={100} value={volume} disabled={!music} onChange={(e) => setDraft(Number(e.target.value))} onPointerUp={(e) => release(Number(e.currentTarget.value))} onKeyUp={(e) => release(Number(e.currentTarget.value))} onBlur={(e) => release(Number(e.currentTarget.value))} style={{ accentColor: 'var(--accent)', width: '100%', margin: 0 }} />
      </label>
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

      {settings?.beatSync && recipe && (
        <section aria-label="Beat sync" style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Beat sync</span>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{current?.name ?? 'No music'}</span>
            <button type="button" style={{ ...outline, height: 30, padding: '0 10px' }} onClick={() => { chooser.current?.scrollIntoView?.({ block: 'center' }); chooser.current?.querySelector('input')?.focus(); }}>Change</button>
          </div>
          <div role="group" aria-label="Mood" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Mood</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {MOOD_CHIPS.map(([id, label]) => (
                <button key={id} type="button" aria-pressed={recipe.mood === id} style={chip(recipe.mood === id)}
                  onClick={() => { if (recipe.mood !== id) void commit({ ops: [{ op: recipe.mood === undefined ? 'add' : 'replace', path: '/mood', value: id }], summary: 'Music mood' }); }}>{label}</button>
              ))}
            </div>
          </div>
          {beatState === 'beats-no-music' && (
            <>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Add music to sync cuts to its beat.</span>
              <button type="button" style={outline} onClick={() => navigate('Music', route.params)}>Choose music</button>
            </>
          )}
          {beatState === 'beats-finding' && <span role="status" style={{ fontSize: 12, color: 'var(--muted)' }}>Finding the beats…</span>}
          {beatState === 'beats-none' && <span style={{ fontSize: 12, color: 'var(--muted)' }}>No steady beat in this track, so cuts follow the pace instead.</span>}
          {(beatState === 'beats-on' || (beatState === 'beats-none' && music)) && peaks && <Wave peaks={peaks} beats={recipe.beats ?? []} total={current?.durationMs ?? 1} cuts={recipe.scenes.reduce<number[]>((a, sc) => [...a, (a.at(-1) ?? 0) + sc.durationMs], []).slice(0, -1)} />}
          {music && (
            <>
              <div aria-label="Scenes" style={{ display: 'flex', gap: 2, height: 22 }}>
                {recipe.scenes.map((sc, i) => <div key={sc.id ?? i} style={{ flex: `${sc.durationMs} 0 0`, background: 'var(--tint)', border: '1px solid var(--line)', borderRadius: 4, fontSize: 10, color: 'var(--muted)', display: 'grid', placeItems: 'center' }}>{i + 1}</div>)}
              </div>
              <div style={{ display: 'flex', gap: 14, fontSize: 11, color: 'var(--muted)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span aria-hidden="true" style={{ width: 2, height: 10, background: 'var(--accent)' }} />Beat</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)' }} />Cut snapped to beat</span>
              </div>
            </>
          )}
          {music && bpm && (
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12 }}>{beatState === 'beats-on' && recipe.beatSync ? `Cuts land on the beat · ${bpm} BPM` : 'Beat sync'}</span>
              <input type="checkbox" role="switch" checked={!!recipe.beatSync} onChange={(e) => { const edit = beatSyncEdit(recipe, undefined, e.target.checked); if (edit) void commit(edit); }} style={{ accentColor: 'var(--accent)' }} />
            </label>
          )}
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Found on this computer. The music never leaves it.</span>
          <button type="button" style={outline} onClick={close}>Done</button>
        </section>
      )}

      <div style={{ flexGrow: 1 }} />
      <button type="button" style={outline} onClick={() => { openMediaTab('audio'); navigate('MediaSearch', route.params); }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>Search free music
      </button>
      <button type="button" style={outline} onClick={() => navigate('YourMedia', route.params)}>Use your own music</button>
    </DialogShell>
  );
}
