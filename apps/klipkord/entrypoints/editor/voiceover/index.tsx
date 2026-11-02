import { useEffect, useRef, useState } from 'react';
import type { EditorSlots } from '../Editor';
import type { SlotProps } from '../components/slots';
import { AddMedia } from '../dialogs/AddMedia';
import { registerTimelineAction, select, timelineState } from '../timeline/store';
import { videoStore } from '@/lib/videoStore';
import { group } from '@/lib/project/history';
import { addVoiceover, fileName, mediaSource, voiceRange } from '@/lib/project/media';
import { newId, setAudio, LABELS } from '@/lib/project/ops';
import { toRec } from '@/lib/project/time';
import { startTake, stopTake } from './record';
import { VoiceoverPanel, VoiceoverPill } from './VoiceoverPanel';
import { setVoiceover, subscribeVoiceover, voiceoverBusy, voiceoverState } from './state';

/** Add media (A) and Voiceover (V): registers both with the timeline and draws their dialog and recording pill. */
export function MediaHost(p: SlotProps) {
  const props = useRef(p);
  props.current = p;
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const begin = () => {
      if (voiceoverBusy()) { stopTake(); return; }
      const { cut, out, recording, project } = props.current;
      const selected = timelineState().selected;
      const range = voiceRange(cut, { out, selectedClips: selected?.kind === 'clips' ? selected.ids : [], transcript: recording.transcript });
      if (range.endOut - range.startOut < 500) return;
      void startTake({
        ...range,
        seek: (o) => props.current.seek(o),
        play: () => props.current.play(),
        pause: () => props.current.pause?.(),
        async save(blob, ms, startOut) {
          const id = newId();
          const file = fileName('voiceover', id, 'webm');
          await videoStore.put(project.id, file, blob);
          const now = props.current;
          const source = mediaSource({ id, kind: 'voiceover', file, mime: 'audio/webm', name: 'Voiceover', probed: { duration: ms, video: false, audio: true } });
          const at = Math.round(toRec(now.cut, startOut) ?? 0);
          const clean = voiceoverState().clean;
          const takeId = newId();
          now.edit((q) => group(q, LABELS.voiceover, (r) => {
            const added = addVoiceover(r, { source, at, id: takeId });
            return clean ? setAudio(added, { patch: { denoise: true, level: true }, label: LABELS.voiceover }) : added;
          }));
          select({ kind: 'voiceovers', ids: [takeId] });
        },
      });
    };
    const offs = [registerTimelineAction('media', () => setAdding(true)), registerTimelineAction('voiceover', begin)];
    return () => { offs.forEach((off) => off()); stopTake(); };
  }, []);

  // Letter keys belong to the open dialog, not the timeline behind it.
  useEffect(() => {
    if (!adding) return;
    const on = (e: KeyboardEvent) => {
      const t = e.target;
      if (t instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(t.tagName)) return;
      if (e.key.length === 1 && e.key !== ' ') e.preventDefault();
    };
    window.addEventListener('keydown', on, true);
    return () => window.removeEventListener('keydown', on, true);
  }, [adding]);

  return (
    <>
      {adding && <AddMedia p={p} onClose={() => setAdding(false)} />}
      <VoiceoverPill />
    </>
  );
}

/** The inspector cover while a take runs; "Allow mic" asks again by pressing V's action. */
function Cover() {
  return <VoiceoverPanel onAllowMic={() => timelineState().actions.voiceover?.()} />;
}

export const mediaSlots = {
  /** Mounted next to the timeline. */
  Host: MediaHost,
  Cover,
  subscribe: subscribeVoiceover,
} satisfies Pick<EditorSlots, 'subscribe'> & Record<string, unknown>;
export { setVoiceover };
