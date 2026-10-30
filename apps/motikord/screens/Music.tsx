import { useRef, useState } from 'react';
import { IconButton } from '../components/ui';
import { useRouter } from '../entrypoints/editor/router';
import { getMedia, putMedia } from '../lib/media';
import { BUNDLED_TRACKS, bundledAssetId, chooseMusicEdit, clock, DEFAULT_MUSIC, ensureBundledAsset, fadeLabel, FADE_CHOICES, musicSettingEdit, type BundledTrack } from '../lib/music';
import { CloseIcon, DialogShell, openMediaTab, usePreview, useStoredClip } from './MediaSearch';

const row = { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px' } as const;
const outline = { height: 40, borderRadius: 10, border: '1px solid var(--line-strong)', background: 'transparent', color: 'var(--ink)', font: '600 13px/1 var(--font)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer' } as const;
const select = { height: 34, border: '1px solid var(--line-strong)', borderRadius: 8, padding: '0 6px', font: '13px var(--font)', background: 'var(--surface)', color: 'var(--ink)' } as const;

const trackUrl = (t: BundledTrack) => browser.runtime.getURL(`/${t.file}` as '/music/upbeat.wav');

/** Music panel: the bundled CC0 tracks, volume and fades. Writes Recipe.music. */
export default function Music() {
  const { navigate, route } = useRouter();
  const { recipe, commit, close } = useStoredClip();
  const audio = usePreview();
  const [busy, setBusy] = useState(false);
  // The slider moves a local value while dragging; the clip is saved once on release.
  const [draft, setDraft] = useState<number>();
  const saving = useRef(false);
  const music = recipe?.music;
  const current = music && recipe ? recipe.assets[music.assetId] : undefined;
  const bundledId = BUNDLED_TRACKS.find((t) => bundledAssetId(t.id) === music?.assetId)?.id;
  const custom = current && !bundledId ? current : undefined;

  async function choose(t: BundledTrack | null) {
    if (!recipe || busy) return;
    setBusy(true);
    try {
      const asset = t && await ensureBundledAsset(t, { get: getMedia, put: putMedia, fetchTrack: async (x) => (await fetch(trackUrl(x))).blob() });
      await commit(chooseMusicEdit(recipe, asset));
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

      <div role="radiogroup" aria-label="Music track" style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
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

      <div style={{ flexGrow: 1 }} />
      <button type="button" style={outline} onClick={() => { openMediaTab('audio'); navigate('MediaSearch', route.params); }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>Search free music
      </button>
      <button type="button" style={outline} onClick={() => navigate('YourMedia', route.params)}>Use your own music</button>
    </DialogShell>
  );
}
