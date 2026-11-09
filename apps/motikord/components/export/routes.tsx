import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter } from '../../entrypoints/editor/router';
import { clipDuration } from '../../lib/render/drawFrame';
import { getClip, putClip } from '../../lib/db';
import { isPackId, type PackId } from '../../lib/look/packs';
import { cancelExport, clearSession, getSession, subscribe } from '../../lib/exportJob';
import { clipHasCaptions, exportFps, v3Renders } from '../../lib/exportV3';
import { isRestyled, restyle } from '../../lib/restyle/restyle';
import { clipLook } from '../../lib/v3/look';
import { folderFromClick } from '../../screens/Export';
import type { Clip } from '../../lib/types';
import { getMachineResult, getV3, type MachineResult } from '../settings/store';
import { ClipNotFound } from '../../screens/editor/StatesEditor';
import ExportV3, { EXPORT_COPY, type ExportChoiceV3, type ExportProgress } from './ExportV3';
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

/** The export dialog: runs the v3 export in this page through the shared export job, and follows its session. */
export function ExportV3Route() {
  const { replace, back, canGoBack } = useRouter();
  const { clip, clipId } = useClip();
  const close = () => (canGoBack ? back() : replace('Editor', { clipId }));
  const s = useSyncExternalStore(subscribe, getSession);
  const [machine, setMachine] = useState<MachineResult>();
  const [anyway60, setAnyway60] = useState(false);
  const [notice, setNotice] = useState<string>();
  const last = useRef<ExportChoiceV3>(undefined);
  const restart = useRef(false);
  useEffect(() => { void getMachineResult().then(setMachine).catch(() => undefined); }, []);
  const fallback30 = machine?.fps60 === false && !anyway60;
  const mine = s && s.job.clipId === clipId ? s : undefined;

  // Set inside the click, before any await, so a double click starts one run.
  const starting = useRef(false);
  // The folder of the last run, reused by "Export at 60 anyway", which restarts outside a click.
  const lastRoot = useRef<FileSystemDirectoryHandle>(undefined);

  const failed = (error: unknown) => {
    console.error('Motikord: could not start the export', error);
    setNotice(EXPORT_COPY.failed);
  };
  const run = async (choice: ExportChoiceV3, fps: 30 | 60, again?: FileSystemDirectoryHandle) => {
    if (!clip || !isRestyled(clip)) return;
    setNotice(v3Renders(choice.kind) ? undefined : EXPORT_COPY.notYet(choice.kind));
    if (!v3Renders(choice.kind)) return;
    last.current = choice;
    // The folder is asked for first, inside the click.
    const root = again ?? await folderFromClick();
    if (!root) return;
    lastRoot.current = root;
    const [{ startV3Export }, look] = await Promise.all([import('../../lib/encode/v3'), clipLook(clip)]);
    // The session is running once this call returns, so the check in start turns a second click away.
    startV3Export({ clip, look, choice, fps, root }).catch(failed);
  };
  const start = (choice: ExportChoiceV3, fps: 30 | 60, again?: FileSystemDirectoryHandle) => {
    if (starting.current || getSession()?.phase === 'running') return;
    starting.current = true;
    run(choice, fps, again)
      .catch(failed)
      .finally(() => { starting.current = false; });
  };

  useEffect(() => {
    if (!mine) return;
    if (mine.phase === 'done') replace('Exported', { clipId });
    else if (mine.phase === 'cancelled') {
      clearSession();
      if (restart.current && last.current) { restart.current = false; start(last.current, 60, lastRoot.current); }
    } else if (mine.phase !== 'running') replace('Rendering', { clipId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine?.phase]);

  const running = mine?.phase === 'running' ? mine : undefined;
  const progress: ExportProgress | undefined = running && {
    index: running.index + 1, total: running.items.length, aspect: running.items[running.index]?.item.aspect ?? '9:16',
    frame: running.frame, frames: running.frames, finishing: last.current?.finishing ?? false,
  };
  const anyway = () => {
    setAnyway60(true);
    // A run already going at 30 starts again at 60.
    if (running) { restart.current = true; cancelExport(); }
  };
  return (
    <ExportV3 clipSeconds={clip ? Math.round(clipDuration(clip.recipe) / 1000) : 0} hasCaptions={!!clip && isRestyled(clip) && clipHasCaptions(clip.v3)} onClose={close}
      onExport={clip ? (c) => start(c, exportFps(c.fps, fallback30)) : undefined} progress={progress} onCancel={cancelExport}
      fallback30={fallback30} onExport60Anyway={anyway} notice={notice} />
  );
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
