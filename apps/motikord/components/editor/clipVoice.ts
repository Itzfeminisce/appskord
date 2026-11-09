// The clip's voice track: narration you choose or the AI voiceover, kept in OPFS like music (the recipe keeps the path).
import { useEffect, useMemo, useRef, useState } from 'react';
import { deleteMedia, getMedia, mediaPath, putMedia } from '../../lib/media';
import type { Asset, PatchOp, VoiceTrack } from '../../lib/types';
import type { VoiceId } from '../../lib/voice/speech';
import type { CaptionsVoiceProps } from './CaptionsVoice';
import { useEditorV3 } from './context';
import { applyOps, type V3State } from './model';

/** Narration files over this are refused: speech-to-text takes 25 MB and the clip file must carry it. */
export const MAX_NARRATION_BYTES = 15 * 1024 * 1024;
export const NARRATION_TOO_BIG = 'That narration is over 15 MB. Pick a shorter audio file.';
const AUDIO_EXT = /\.(m4a|aac|mp3|wav|ogg|opus|webm|flac)$/i;
/** Browsers leave file.type empty for some audio files (.flac, .opus, .m4a), so the extension decides then. */
export const isAudioFile = (f: { type: string; name: string }): boolean => (f.type ? f.type.startsWith('audio/') : AUDIO_EXT.test(f.name));
export const NARRATION_NOT_AUDIO = 'That file is not audio. Pick an MP3, M4A, WAV, OGG, FLAC or WebM file.';
export const VOICE_NOT_SAVED = 'The voice could not be saved on this computer. Try again.';

const EXT: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac' };

export function voiceAsset(id: string, blob: Blob, name: string, durationMs: number): Asset {
  const mime = blob.type || 'audio/mpeg';
  const named = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  const ext = EXT[mime] ?? (blob.type || !named ? undefined : named) ?? 'audio';
  return { id, kind: 'audio', name, mime, bytes: blob.size, ...(durationMs > 0 ? { durationMs } : {}), opfsPath: mediaPath(id, ext) };
}

const usedElsewhere = (st: V3State, id: string) =>
  st.clip.recipe.music?.assetId === id || st.clip.recipe.scenes.some((s) => s.layers.some((l) => (l.type === 'image' || l.type === 'video') && l.assetId === id));

/** Puts this audio in the clip's voice slot as one undoable change, replacing the voice there. */
export function setVoice(st: V3State, asset: Asset, source: VoiceTrack['source']): V3State {
  const r = st.clip.recipe;
  const cur = r.voice;
  const ops: PatchOp[] = [{ op: 'add', path: `/recipe/assets/${asset.id}`, value: asset }];
  ops.push({ op: cur ? 'replace' : 'add', path: '/recipe/voice', value: { assetId: asset.id, volume: cur?.volume ?? 1, source } satisfies VoiceTrack });
  // The old file stays in OPFS so Undo brings the old voice back.
  if (cur && cur.assetId !== asset.id && r.assets[cur.assetId] && !usedElsewhere(st, cur.assetId)) ops.push({ op: 'remove', path: `/recipe/assets/${cur.assetId}` });
  return applyOps(st, ops, { summary: source === 'voiceover' ? 'AI voiceover added' : `Narration: ${asset.name}` });
}

export interface VoiceMedia {
  get(path: string): Promise<Blob | undefined>;
  put(path: string, blob: Blob): Promise<void>;
  /** Opens the audio file picker; calls back with the chosen file. */
  pick(onFile: (file: File) => void): void;
  durationMs(blob: Blob): Promise<number>;
  /** Deletes a file that was written but never attached to the clip. */
  remove?(path: string): Promise<void>;
  id(): string;
}

function audioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    const done = (ms: number) => { URL.revokeObjectURL(url); resolve(Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0); };
    a.onloadedmetadata = () => done(a.duration * 1000);
    a.onerror = () => done(0);
    a.preload = 'metadata';
    a.src = url;
  });
}

export const pageVoiceMedia: VoiceMedia = {
  get: (path) => getMedia(path),
  put: (path, blob) => putMedia(path, blob),
  remove: (path) => deleteMedia(path),
  pick(onFile) {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'audio/*' });
    input.onchange = () => { const f = input.files?.[0]; if (f) onFile(f); };
    input.click();
  },
  durationMs: audioDuration,
  id: () => `voice-${globalThis.crypto.randomUUID()}`,
};

/** The Voice and captions panel's clip side: the voice's audio, Choose narration and where a made voiceover goes. */
export function useClipVoice(media: VoiceMedia = pageVoiceMedia): Pick<CaptionsVoiceProps, 'narration' | 'onVoiceover' | 'onChooseNarration'> {
  const ed = useEditorV3();
  const r = ed.state.clip.recipe;
  const asset = r.voice ? r.assets[r.voice.assetId] : undefined;
  const [narration, setNarration] = useState<Blob>();
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  useEffect(() => {
    let on = true;
    if (!asset) { setNarration(undefined); return; }
    media.get(asset.opfsPath).then((b) => { if (on) setNarration(b); }).catch((error: unknown) => { console.error('Motikord: could not read the clip voice', error); });
    return () => { on = false; };
  }, [asset?.opfsPath, media]);
  return useMemo(() => {
    const fail = (message: string) => ed.update((st) => ({ ...st, errors: [message] }));
    const keep = async (blob: Blob, name: string, source: VoiceTrack['source']): Promise<number> => {
      const ms = await media.durationMs(blob);
      const a = voiceAsset(media.id(), blob, name, ms);
      await media.put(a.opfsPath, blob);
      if (live.current) ed.update((st) => setVoice(st, a, source));
      else await media.remove?.(a.opfsPath).catch((error: unknown) => { console.error('Motikord: could not delete an unused voice file', error); });
      return ms;
    };
    return {
      narration,
      onVoiceover: (audio: Blob, voice: VoiceId) => keep(audio, `AI voiceover (${voice})`, 'voiceover'),
      onChooseNarration: () => media.pick((file) => {
        if (!isAudioFile(file)) return fail(NARRATION_NOT_AUDIO);
        if (file.size > MAX_NARRATION_BYTES) return fail(NARRATION_TOO_BIG);
        keep(file, file.name, 'narration').catch((error: unknown) => {
          console.error('Motikord: could not keep the narration', error);
          fail(VOICE_NOT_SAVED);
        });
      }),
    };
    // ed.update is stable for the editor's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narration, media]);
}
