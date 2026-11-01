import { useEffect, useState } from 'react';
import { useRouter } from '../entrypoints/sidepanel/router';
import { getClip } from '../lib/db';
import { dismissJob, findInterrupted, type StoredJob } from '../lib/exportJob';
import { KIND_LABEL } from '../lib/fileNames';
import { savedFolder } from '../lib/folder';
import type { Clip } from '../lib/types';

/** "9:16 · MP4 · 1080p · stopped at 46%" */
export function stoppedLine(job: StoredJob): string {
  return [job.aspects.join(', '), job.kinds.map((k) => KIND_LABEL[k]).join(', '), job.quality, `stopped at ${Math.floor(job.percent ?? 0)}%`].join(' · ');
}

/** Export interrupted: shown at start-up when an export did not finish. Edits are saved after every change, so only the file is redone. */
export default function Recovered() {
  const { replace } = useRouter();
  const [found, setFound] = useState<{ job: StoredJob; clip: Clip; thumb?: string }>();
  useEffect(() => {
    let url: string | undefined;
    let live = true;
    (async () => {
      for (const job of await findInterrupted(Date.now())) {
        const clip = await getClip(job.clipId);
        // The clip was deleted since: nothing left to export.
        if (!clip) { await dismissJob(job.id); continue; }
        url = clip.thumbnail ? URL.createObjectURL(clip.thumbnail) : undefined;
        if (live) setFound({ job, clip, thumb: url });
        return;
      }
      if (live) replace('Home');
    })().catch((error: unknown) => console.error('Motikord: could not read the interrupted export', error));
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [replace]);

  const again = async () => {
    if (!found) return;
    // Asked from this click, so the editor tab can write to the folder straight away.
    await savedFolder(true).catch(() => undefined);
    const q = new URLSearchParams({ clip: found.clip.id, export: found.job.id, screen: 'Rendering' });
    await browser.tabs.create({ url: browser.runtime.getURL(`/editor.html?${q}` as '/') });
    replace('Home');
  };
  const notNow = async () => {
    if (found) await dismissJob(found.job.id).catch((error: unknown) => console.error('Motikord: could not forget the interrupted export', error));
    replace('Home');
  };
  const name = found?.clip.recipe.name ?? '';

  return (
    <main data-frame="Recovered" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', background: 'var(--ground)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 24px 0' }}>
        <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--ink)', display: 'grid', placeItems: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true"><path d="M3 8.5h5M2 12h6M3 15.5h5" /><circle cx="15.5" cy="12" r="4.5" fill="#BE185D" stroke="none" /></svg>
        </span>
        <span style={{ fontSize: 16, fontWeight: 600 }}>Motikord</span>
      </div>
      {found && (
        <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 24px', gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.2, fontWeight: 600, letterSpacing: '-0.02em' }}>An export didn’t finish</h1>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--muted)' }}>{`Chrome closed while “${name}” was exporting. Your clip and every change are safe. Only the video file wasn’t made.`}</p>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: 12, borderRadius: 14, background: 'var(--surface)', border: '1px solid var(--line)' }}>
            <span style={{ width: 34, height: 60, borderRadius: 6, background: found.thumb ? `url("${found.thumb}") center / cover` : 'var(--tint-strong)', flexShrink: 0 }} />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{name}</span><span style={{ fontSize: 12, color: 'var(--muted)' }}>{stoppedLine(found.job)}</span></span>
          </div>
          <button type="button" className="btn btn-primary btn-block" onClick={() => void again()} style={{ height: 48, borderRadius: 12 }}><span className="btn-label">Export it again</span></button>
          <button type="button" onClick={() => void notNow()} style={{ alignSelf: 'center', background: 'none', border: 0, color: 'var(--accent)', font: '500 13px/1.45 var(--font)', cursor: 'pointer' }}>Not now</button>
        </div>
      )}
    </main>
  );
}
