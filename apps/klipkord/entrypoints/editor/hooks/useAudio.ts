import { useEffect, useRef } from 'react';
import { spanAt } from '@/lib/project/time';
import type { Cut, Project, Source } from '@/lib/project/types';
import type { AudioOut, EditorDeps } from '../deps';
import { audioSources, muteTrack } from '../media';

/** Off by more than this, an element seeks back to the playhead; small drift is left alone to avoid clicks. */
export const DRIFT_S = 0.25;

/** Where one source's sound should be at output time `out`, or null when it is silent there. */
export function audioTarget(cut: Cut, source: Source, out: number): { t: number; rate: number; naturalVoice: boolean } | null {
  const span = spanAt(cut, out);
  if (!span || span.clip.gap) return null;
  const rec = span.clip.in + (out - span.start) * span.clip.speed;
  const t = (rec - source.offset) / 1000;
  if (t < 0 || t * 1000 >= source.duration) return null;
  return { t, rate: span.clip.speed, naturalVoice: span.clip.naturalVoice !== false };
}

/** Plays the mic and tab sound in step with the playhead, following the cut's clips. T12's mix replaces this. */
export function useAudio(project: Project | undefined, cut: Cut | undefined, blobs: Map<string, Blob> | undefined,
  out: number, playing: boolean, audio: EditorDeps['audio']): void {
  const outs = useRef(new Map<string, { source: Source; out: AudioOut }>());

  useEffect(() => {
    if (!project || !blobs) return;
    const made: { dispose(): void }[] = [];
    for (const source of audioSources(project)) {
      const blob = blobs.get(source.id);
      const el = blob && audio(blob);
      if (!el) continue;
      made.push(el);
      outs.current.set(source.id, { source, out: el.out });
    }
    const all = outs.current;
    return () => {
      made.forEach((m) => m.dispose());
      all.clear();
    };
    // Sources only change when the project gains media, not on every edit.
  }, [project?.sources, blobs, audio]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!cut) return;
    for (const { source, out: el } of outs.current.values()) {
      const target = playing ? audioTarget(cut, source, out) : null;
      const track = cut.tracks[muteTrack(source)];
      if (!target || track?.muted || track?.hidden) {
        if (!el.paused) el.pause();
        continue;
      }
      el.volume = Math.max(0, Math.min(1, source.kind === 'tab' ? cut.audio.tabVolume : cut.audio.voiceVolume));
      if (el.playbackRate !== target.rate) el.playbackRate = target.rate;
      el.preservesPitch = target.naturalVoice;
      if (Math.abs(el.currentTime - target.t) > DRIFT_S) el.currentTime = target.t;
      if (el.paused) el.play().catch((error: unknown) => console.error('Klipkord: could not play audio', error));
    }
  }, [cut, out, playing]);
}
