import { useEffect, useState } from 'react';
import { useRouter } from '../../entrypoints/editor/router';
import { clipDuration } from '../../lib/render/drawFrame';
import { getClip, putClip } from '../../lib/db';
import { isPackId, type PackId } from '../../lib/look/packs';
import { restyle } from '../../lib/restyle/restyle';
import type { Clip } from '../../lib/types';
import { getV3 } from '../settings/store';
import { ClipNotFound } from '../../screens/editor/StatesEditor';
import ExportV3 from './ExportV3';
import RestyleV2 from './RestyleV2';

// The editor tab's routes for the two v3 dialogs. Both read the stored clip, like the v2 dialogs do.

function useClip(): { clip?: Clip; clipId?: string; missing: boolean } {
  const { route } = useRouter();
  const clipId = route.params.clipId ?? new URLSearchParams(location.search).get('clip') ?? undefined;
  const [clip, setClip] = useState<Clip>();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    if (!clipId) { setMissing(true); return; }
    getClip(clipId)
      .then((c) => { if (!live) return; setClip(c); setMissing(!c); })
      .catch((error: unknown) => { console.error('Motikord: could not open the clip', error); if (live) setMissing(true); });
    return () => { live = false; };
  }, [clipId]);
  return { clip, clipId, missing };
}

/** The export dialog. Starting a run is the job runner's: this task installs the screen, not the runner. */
export function ExportV3Route() {
  const { replace, back, canGoBack } = useRouter();
  const { clip, clipId } = useClip();
  const close = () => (canGoBack ? back() : replace('Editor', { clipId }));
  return <ExportV3 clipSeconds={clip ? Math.round(clipDuration(clip.recipe) / 1000) : 0} hasCaptions={false} onClose={close} />;
}

/** The restyle dialog: restyles to v3 and opens the clip in the v3 editor, where the key frames wait when asked for. */
export function RestyleV2Route() {
  const { replace, back, canGoBack } = useRouter();
  const { clip, clipId, missing } = useClip();
  const close = () => (canGoBack ? back() : replace('Editor', { clipId }));
  if (missing) return <main data-frame="RestyleV2" style={{ flexGrow: 1, display: 'grid', placeItems: 'center', padding: 16 }}><div style={{ width: 400, maxWidth: '100%' }}><ClipNotFound onGo={close} label="Close" /></div></main>;
  if (!clip) return <main data-frame="RestyleV2" />;
  const style = clip.recipe.style ?? 'clean';
  const meta = `${Math.round(clipDuration(clip.recipe) / 1000)} s · ${clip.recipe.aspect} · ${style[0]!.toUpperCase()}${style.slice(1)}`;
  const packId: PackId = isPackId(style) ? style : 'clean';
  const onRestyle = async ({ packId, keyFramesFirst }: { packId: PackId; keyFramesFirst: boolean }) => {
    const settings = await getV3();
    const now = Date.now();
    await putClip(restyle(clip, { packId, keyFramesFirst, fps: settings.fps === 60 ? 60 : 30, now, changeId: `restyle-${now}` }));
    replace('Editor', { clipId });
  };
  return <RestyleV2 name={clip.recipe.name} meta={meta} packId={packId} onRestyle={onRestyle} onClose={close} />;
}
