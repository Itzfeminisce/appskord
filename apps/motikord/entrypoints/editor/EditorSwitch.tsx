import { lazy, Suspense, useEffect, useState } from 'react';
import type { LookGuide } from '@appskord/motion/types';
import type { ChromeGo } from '../../components/editor/EditorV3';
import { getClip, putClip } from '../../lib/db';
import { devSampleV2 } from '../../lib/editor/v2';
import { getLook } from '../../lib/look/store';
import { PROVIDERS } from '../../lib/providers';
import { isRestyled, openV2Version, restyle, type RestyledClip } from '../../lib/restyle/restyle';
import { devTools } from '../../lib/router';
import { getSettings } from '../../lib/settings';
import { goInSidePanel, openSidePanel, useWindowId } from '../../lib/sidepanelGo';
import type { Author, Clip } from '../../lib/types';
import Editor from '../../screens/editor/Editor';
import { useRouter } from './router';

// The Editor route: a v3 clip opens in the v3 editor; every other clip opens in the v2 editor unchanged.

// three.js and the v3 panels load only when a v3 clip opens; the side panel shares this router's chunk.
const EditorV3 = lazy(() => import('../../components/editor/EditorV3').then((m) => ({ default: m.EditorV3 })));

const DEV_V3 = 'dev-sample-v3';

/** Dev only: the v2 sample restyled with v3 motion. */
function devSampleV3(): RestyledClip {
  const now = Date.now();
  const clip: Clip = { id: DEV_V3, recipe: devSampleV2(DEV_V3), history: [], createdAt: now, updatedAt: now };
  return restyle(clip, { now, changeId: 'restyle-dev' });
}

async function openV3(id: string | undefined): Promise<RestyledClip | undefined> {
  if (!id) return undefined;
  let clip = await getClip(id);
  if (!clip && devTools && id === DEV_V3) {
    clip = devSampleV3();
    await putClip(clip);
  }
  return clip && isRestyled(clip) ? clip : undefined;
}

interface V3Open { clip: RestyledClip; look?: LookGuide; provider: string; by: Author }

export default function EditorSwitch() {
  const { route, navigate } = useRouter();
  const win = useWindowId();
  const clipId = route.params.clipId ?? new URLSearchParams(location.search).get('clip') ?? undefined;
  const [open, setOpen] = useState<V3Open | null>();
  useEffect(() => {
    let live = true;
    setOpen(undefined);
    openV3(clipId)
      .then(async (clip) => {
        if (!clip) return live && setOpen(null);
        const [saved, settings] = await Promise.all([getLook(clip.v3.lookGuideId).catch(() => undefined), getSettings().catch(() => undefined)]);
        const local = settings?.ai === 'local';
        const provider = local ? 'Built-in AI' : PROVIDERS[settings?.provider ?? 'groq'].label;
        if (live) setOpen({ clip, look: saved?.guide, provider, by: local ? 'builtin' : (settings?.provider ?? 'groq') });
      })
      .catch((error: unknown) => {
        console.error('Motikord: could not open the clip', error);
        if (live) setOpen(null);
      });
    return () => { live = false; };
  }, [clipId]);
  if (open === undefined) return null;
  if (open === null) return <Editor />;
  const go = (to: ChromeGo) => {
    const params = { clipId: open.clip.id };
    if (to === 'library') goInSidePanel(win.current, 'Library');
    else if (to === 'look') openSidePanel(win.current);
    else navigate(to === 'brand' ? 'BrandKit' : to === 'check' ? 'Checker' : 'Export', params);
  };
  return (
    <Suspense fallback={null}>
      <EditorV3 key={open.clip.id} clip={open.clip} look={open.look} provider={open.provider} by={open.by} go={go} save={putClip}
        onOpenV2={(clip) => void putClip(openV2Version(clip)).then(() => location.reload())} />
    </Suspense>
  );
}
