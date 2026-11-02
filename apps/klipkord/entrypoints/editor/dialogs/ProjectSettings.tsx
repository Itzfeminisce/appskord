import { useEffect, useState } from 'react';
import { flushProjects, deleteProject } from '@/lib/project/store';
import type { Project, Source } from '@/lib/project/types';
import { formatBytes } from '@/lib/time';
import type { SlotProps } from '../components/slots';
import { useDeps } from '../deps';
import { clock } from '../format';
import { countClicks } from '../media';
import { dayAndTime } from '../../sidepanel/screens/Home';
import { Modal, Switch, TL_ICONS } from '../timeline/controls';
import { C, Icon } from '../ui';

const TRACK_NAMES: Partial<Record<Source['kind'], string>> = { screen: 'screen', baked: 'screen', camera: 'camera', mic: 'mic', tab: 'tab sound' };

/** "Screen, camera, mic, tab sound, 14 clicks". */
export function trackList(sources: Source[], clicks: number): string {
  const names = [...new Set(sources.map((s) => TRACK_NAMES[s.kind]).filter((n): n is string => !!n))];
  if (clicks > 0) names.push(`${clicks} clicks`);
  const text = names.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Project options are settings, not edits: they change without an Undo step. */
export const withOptions = (patch: Partial<Project['options']>) => (p: Project): Project => ({ ...p, options: { ...p.options, ...patch } });
/** Renames the project; a blank name keeps the last one (`name-empty`). */
export const withName = (name: string) => (p: Project): Project => (name.trim() && name.trim() !== p.name ? { ...p, name: name.trim() } : p);

/** ProjectSettings: name, recording facts, light preview, bake camera, tour again, duplicate, delete. */
export function ProjectSettings({ p, onClose }: { p: SlotProps; onClose: () => void }) {
  const deps = useDeps();
  const [name, setName] = useState(p.project.name);
  const [clicks, setClicks] = useState(0);
  const { options } = p.project;
  useEffect(() => {
    if (!p.project.events) return;
    let live = true;
    void countClicks(p.project.id).then((n) => { if (live) setClicks(n); });
    return () => { live = false; };
  }, [p.project.id, p.project.events]);
  const empty = !name.trim();
  const close = () => { if (!empty) p.edit(withName(name)); onClose(); };
  const remove = () => {
    // The recording stays in the Library; only its edits go. Its next open starts from the recording again.
    flushProjects().then(() => deleteProject(p.project.id)).then(() => { deps.openPanel('Library'); deps.closeTab(); },
      (error: unknown) => console.error('Klipkord: could not delete the project', error));
  };
  const opts = (patch: Partial<Project['options']>) => p.edit(withOptions(patch));
  return (
    <Modal label="Project settings" width={520} onClose={close}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label htmlFor="klipkord-project-name" style={{ fontSize: 11.5, color: C.secondary }}>Project name</label>
        <input id="klipkord-project-name" value={name} onChange={(e) => setName(e.target.value)} disabled={p.readOnly}
          onBlur={() => { if (empty) setName(p.project.name); else p.edit(withName(name)); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          style={{ height: 34, borderRadius: 8, border: `1px solid ${empty ? C.accentText : C.line}`, background: C.ground, color: C.text, padding: '0 10px', fontFamily: 'inherit', fontSize: 13 }} />
        {empty && (
          <div data-state="name-empty" role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5 }}>
            <span style={{ fontWeight: 600 }}>Give the project a name</span>
            <span style={{ color: C.secondary, lineHeight: 1.5 }}>The name can't be empty. It goes back to the last one if you leave it blank.</span>
          </div>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 12.5 }}>
        <span style={{ color: C.secondary }}>Recorded</span><span>{`${dayAndTime(p.recording.createdAt)} · ${p.recording.mode} · ${clock(p.recording.duration)}`}</span>
        <span style={{ color: C.secondary }}>Tracks</span><span>{trackList(p.project.sources, clicks)}</span>
        <span style={{ color: C.secondary }}>Space used</span><span>{`${formatBytes(p.recording.bytes)} on this computer`}</span>
      </div>
      <Switch label="Light preview" sub="Smoother on slower computers. Exports are always full quality." on={options.lightPreview} disabled={p.readOnly} onChange={(on) => opts({ lightPreview: on })} />
      <Switch label="Bake camera into the video" sub="For new recordings. Off keeps the camera separate so you can move it here." on={options.bakeCamera} disabled={p.readOnly} onChange={(on) => opts({ bakeCamera: on })} />
      <Switch label="Show the first-time tour again" on={options.tour} disabled={p.readOnly} onChange={(on) => opts({ tour: on })} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled style={{ height: 30, padding: '0 12px', borderRadius: 8, background: C.raised, color: C.text, border: `1px solid ${C.line}`, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, opacity: 0.5 }}>
          <Icon>{TL_ICONS.copy}</Icon><span>Duplicate project</span>
        </button>
        <button type="button" onClick={remove} disabled={p.readOnly} style={{ height: 30, padding: '0 12px', borderRadius: 8, background: 'transparent', color: '#FCA5A5', border: 0, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <Icon>{TL_ICONS.trash}</Icon><span>Delete project</span>
        </button>
      </div>
    </Modal>
  );
}
