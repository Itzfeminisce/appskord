import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { openSource } from '@appskord/media';
import { TRACKS, type Track as Song } from '@/lib/audio/tracks';
import { listRecordings } from '@/lib/db';
import { whenLabel } from '@/lib/library';
import { recordingLength } from '@/lib/project/cuts';
import { addMedia, addMusic, extensionOf, fileName, formatOf, mediaSource, placeAt, type MediaKind, type Probed } from '@/lib/project/media';
import { newId } from '@/lib/project/ops';
import type { Recording } from '@/lib/types';
import { videoStore } from '@/lib/videoStore';
import type { SlotProps } from '../components/slots';
import { clock } from '../format';
import { StateCard } from '../states/StateCard';
import { Seg, TL_ICONS, useEscape } from '../timeline/controls';
import { actionButton, C, Icon, iconButton } from '../ui';

export type Section = 'recordings' | 'computer' | 'music';
const SECTIONS = [
  { value: 'recordings', label: 'Your recordings' }, { value: 'computer', label: 'From this computer' }, { value: 'music', label: 'Music' },
] as const;

/** What the person picked; Add turns it into a source and a placement. */
type Choice = { kind: 'recording'; rec: Recording } | { kind: 'file'; file: File } | { kind: 'track'; track: Song } | { kind: 'own-music'; file: File };

/** Everything AddMedia reaches outside React; tests pass fakes. */
export interface MediaIO {
  recordings(): Promise<Recording[]>;
  /** The recording's whole video. */
  video(rec: Recording): Promise<Blob>;
  track(song: Song): Promise<Blob>;
  put(recordingId: string, name: string, data: Blob): Promise<void>;
  probe(blob: Blob, kind: MediaKind): Promise<Probed>;
}

async function probe(blob: Blob, kind: MediaKind): Promise<Probed> {
  if (kind === 'image') {
    const bitmap = await createImageBitmap(blob);
    const out = { duration: 0, width: bitmap.width, height: bitmap.height, video: false, audio: false };
    bitmap.close();
    return out;
  }
  const s = await openSource(blob);
  try {
    if (kind === 'sound' ? !s.audio : !s.video) throw new Error('no usable track');
    return { duration: s.duration * 1000, width: s.video?.width, height: s.video?.height, video: !!s.video, audio: !!s.audio };
  } finally {
    s.dispose();
  }
}

export const browserMediaIO: MediaIO = {
  recordings: listRecordings,
  video: (rec) => videoStore.read(rec.id, 'video', rec.mime),
  async track(song) {
    const res = await fetch(song.file);
    if (!res.ok) throw new Error(`music file ${song.file} answered ${res.status}`);
    return res.blob();
  },
  put: (id, name, data) => videoStore.put(id, name, data),
  probe,
};

const MODES = { tab: 'Tab', window: 'Window', screen: 'Screen' } as const;

/** A file AddMedia cannot read: the import-unsupported card names it. */
class Unsupported extends Error {
  constructor(readonly file: string) { super(`cannot read ${file}`); }
}

/**
 * Copies the choice into the recording's OPFS folder and returns the project edit that places it at the playhead.
 * Throws Unsupported for a file Chrome cannot read.
 */
export async function importChoice(choice: Choice, p: Pick<SlotProps, 'project' | 'cut' | 'out'>, io: MediaIO): Promise<(project: SlotProps['project']) => SlotProps['project']> {
  const id = newId();
  const recId = p.project.id;
  if (choice.kind === 'track' || choice.kind === 'own-music') {
    const blob = choice.kind === 'track' ? await io.track(choice.track) : choice.file;
    const name = choice.kind === 'track' ? choice.track.name : choice.file.name;
    const ext = choice.kind === 'track' ? extensionOf(choice.track.file) : formatOf(choice.file.name)?.ext;
    const fmt = formatOf(`x.${ext}`);
    if (!fmt || fmt.kind !== 'sound') throw new Unsupported(name);
    const probed = await io.probe(blob, 'sound').catch(() => { throw new Unsupported(name); });
    const file = fileName('music', id, fmt.ext);
    await io.put(recId, file, blob);
    const source = mediaSource({ id, kind: 'music', file, mime: fmt.mime, name, probed });
    return (project) => addMusic(project, { source });
  }
  const name = choice.kind === 'file' ? choice.file.name : choice.rec.title;
  const fmt = choice.kind === 'file' ? formatOf(choice.file.name) : { kind: 'video' as const, ext: choice.rec.mime.includes('mp4') ? 'mp4' : 'webm', mime: choice.rec.mime };
  if (!fmt) throw new Unsupported(name);
  const blob = choice.kind === 'file' ? choice.file : await io.video(choice.rec);
  const probed = await io.probe(blob, fmt.kind).catch(() => { throw new Unsupported(name); });
  const file = fileName('media', id, fmt.ext);
  await io.put(recId, file, blob);
  const source = mediaSource({ id, kind: 'media', file, mime: fmt.mime, name, probed });
  const at = placeAt(p.cut, p.out, recordingLength(p.project.sources));
  return (project) => addMedia(project, { source, at });
}

const ROW = { display: 'flex', alignItems: 'center', gap: 12, padding: 8, borderRadius: 10, color: C.text, fontFamily: 'inherit', textAlign: 'left', cursor: 'pointer' } as const;
const row = (on: boolean) => ({ ...ROW, border: `1px solid ${on ? C.accentText : C.line}`, background: C.raised });

function Thumb({ rec }: { rec: Recording }) {
  const url = useMemo(() => (rec.thumbnail ? URL.createObjectURL(rec.thumbnail) : ''), [rec.thumbnail]);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  return <span style={{ width: 72, height: 40, borderRadius: 5, flexShrink: 0, background: url ? `center / cover url(${url})` : `linear-gradient(135deg, #7C2D12, ${C.accent})` }} />;
}

/** AddMedia (key A, the + on Media and Sound): your recordings, files from this computer, music. */
export function AddMedia({ p, onClose, io = browserMediaIO, start = 'recordings' }: { p: SlotProps; onClose: () => void; io?: MediaIO; start?: Section }) {
  useEscape(onClose);
  const [section, setSection] = useState<Section>(start);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [recs, setRecs] = useState<Recording[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const ownMusic = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    io.recordings().then((all) => {
      if (live) setRecs(all.filter((r) => r.id !== p.project.id && r.status === 'ready').sort((a, b) => b.createdAt - a.createdAt));
    }, (error: unknown) => console.error('Klipkord: could not list recordings', error));
    return () => { live = false; };
  }, [io, p.project.id]);

  const take = (file: File | undefined, music = false) => {
    if (!file) return;
    if (!music && !formatOf(file.name)) { setUnsupported(file.name); return; }
    setUnsupported(null);
    setChoice(music ? { kind: 'own-music', file } : { kind: 'file', file });
  };
  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    setSection('computer');
    take(e.dataTransfer.files[0]);
  };
  const add = async () => {
    if (!choice || busy) return;
    setBusy(true);
    try {
      p.edit(await importChoice(choice, p, io));
      onClose();
    } catch (error) {
      if (error instanceof Unsupported) setUnsupported(error.file);
      else console.error('Klipkord: could not add the media', error);
      setBusy(false);
    }
  };

  const at = clock(p.out);
  const picked = choice?.kind === 'file' ? choice.file.name : choice?.kind === 'own-music' ? choice.file.name : null;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(5,5,7,0.62)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 20 }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onDragOver={(e) => e.preventDefault()} onDrop={drop}>
      <div role="dialog" aria-label="Add to this video" style={{ width: 560, maxHeight: 600, borderRadius: 14, background: C.panel, border: `1px solid ${C.line}`, boxShadow: '0 24px 60px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', overflow: 'hidden', color: C.text }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '16px 16px 0 20px' }}>
          <div style={{ flexGrow: 1 }}><h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Add to this video</h2></div>
          <button type="button" aria-label="Close (Esc)" title="Close (Esc)" onClick={onClose} style={iconButton()}><Icon>{TL_ICONS.close}</Icon></button>
        </div>
        <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
          <Seg label="Add from" options={SECTIONS} value={section} onChange={(v) => { setSection(v); setChoice(null); setUnsupported(null); }} />
          {unsupported && (
            <StateCard state="import-unsupported" role="alert" title={`Can't add ${unsupported}`} body="Chrome can't read this kind of video. Try MP4, WebM or MOV."
              actions={[{ label: 'Choose another file', tone: 'secondary', onClick: () => { setUnsupported(null); (section === 'music' ? ownMusic : input).current?.click(); } }]} />
          )}
          {section === 'recordings' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {recs.map((r) => (
                <button key={r.id} type="button" aria-pressed={choice?.kind === 'recording' && choice.rec.id === r.id} onClick={() => setChoice({ kind: 'recording', rec: r })} style={row(choice?.kind === 'recording' && choice.rec.id === r.id)}>
                  <Thumb rec={r} />
                  <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                    <span style={{ fontSize: 11.5, color: C.muted }}>{`${MODES[r.mode]} · ${clock(r.duration)} · ${whenLabel(r.createdAt, Date.now())}`}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {section === 'music' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {TRACKS.map((t) => (
                <button key={t.id} type="button" aria-pressed={choice?.kind === 'track' && choice.track.id === t.id} onClick={() => setChoice({ kind: 'track', track: t })} style={row(choice?.kind === 'track' && choice.track.id === t.id)}>
                  <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{t.name}</span>
                    <span style={{ fontSize: 11.5, color: C.muted }}>{t.about}</span>
                  </span>
                </button>
              ))}
              <button type="button" onClick={() => ownMusic.current?.click()} style={{ ...actionButton('secondary'), alignSelf: 'flex-start' }}>{picked && choice?.kind === 'own-music' ? picked : 'Use your own file'}</button>
              <input ref={ownMusic} type="file" accept="audio/*,.mp3,.wav,.m4a" hidden onChange={(e) => { take(e.target.files?.[0], true); e.target.value = ''; }} />
            </div>
          )}
          {section !== 'music' && (
            <div role="button" tabIndex={0} aria-label="Drop a video, image or sound here" onClick={() => input.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click(); } }}
              onDragEnter={() => setOver(true)} onDragLeave={() => setOver(false)}
              style={{ border: `1.5px dashed ${over || picked ? C.accentText : C.line}`, borderRadius: 12, padding: 18, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, textAlign: 'center', cursor: 'pointer' }}>
              <span style={{ color: C.secondary }}><Icon size={20}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></Icon></span>
              <span style={{ fontSize: 13, fontWeight: 500 }}>{picked && choice?.kind === 'file' ? picked : 'Drop a video, image or sound here'}</span>
              <span style={{ fontSize: 12, color: C.muted }}>MP4, WebM, MOV, PNG, JPG, GIF, MP3, WAV, M4A</span>
            </div>
          )}
          <input ref={input} type="file" accept="video/mp4,video/webm,video/quicktime,image/png,image/jpeg,image/gif,audio/mpeg,audio/wav,audio/mp4,.mp4,.webm,.mov,.png,.jpg,.jpeg,.gif,.mp3,.wav,.m4a,.mkv,.avi" hidden
            onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }} />
          <p style={{ margin: 0, fontSize: 12, color: C.muted }}>{`Added at the playhead (${at}) on its own track. Files stay on this computer.`}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 20px', borderTop: `1px solid ${C.line}` }}>
          <span style={{ flexGrow: 1 }} />
          <button type="button" onClick={onClose} style={{ ...actionButton('ghost'), height: 32 }}>Cancel</button>
          <button type="button" onClick={() => void add()} disabled={!choice || busy} style={{ ...actionButton('primary'), height: 32, background: C.accent, color: '#FFFFFF', opacity: choice && !busy ? 1 : 0.5 }}>Add</button>
        </div>
      </div>
    </div>
  );
}
