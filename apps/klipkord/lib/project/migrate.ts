import { keptRanges } from '../editList';
import type { Recording } from '../types';
import { blankCut, defaultFit, DEFAULT_LOOK, FULL_CUT_NAME, PLAIN_LOOK, wholeClips } from './cuts';
import { newId } from './ops';
import type { Project, Source } from './types';

/** The recording's own default title, used when a title is blank: a project name is never empty. */
const UNTITLED = 'Untitled recording';

/** v1 and v2 recordings: their one video file (`video` segments under the recording's folder), camera baked in. */
export function bakedSource(rec: Recording): Source {
  const height = rec.height ?? (rec.quality === '1080p' ? 1080 : 720);
  return {
    id: 'baked', kind: 'baked', file: 'video', mime: rec.mime, offset: 0, duration: rec.duration,
    width: Math.round((height * 16) / 9), height, video: true, audio: true,
  };
}

/**
 * Builds the project for a recording. v1/v2: one baked source, the "Full" cut keeps its kept ranges,
 * chapters come from the notes. v3: the recorded sources, the whole recording and default layers.
 */
export function fromRecording(rec: Recording, sources: Source[] = [], options: Partial<Project['options']> = {}): Project {
  const v3 = !!rec.v3;
  const list = v3 ? sources : [bakedSource(rec)];
  const events = v3 ? rec.v3!.events : false;
  const clips = v3
    ? wholeClips(list)
    : keptRanges(rec.edits, rec.duration).map((r) => ({ id: newId(), in: r.start, out: r.end, speed: 1 }));
  const cut = blankCut({
    name: FULL_CUT_NAME, made: 'full', clips, look: v3 ? DEFAULT_LOOK : PLAIN_LOOK, fit: defaultFit(list, events),
  });
  return {
    id: rec.id, version: 3, name: rec.title.trim() || UNTITLED,
    sources: list, events,
    wordFixes: {}, chapters: [...(rec.summary?.chapters ?? [])].sort((a, b) => a.at - b.at), translations: {},
    cuts: [cut], current: cut.id, history: { [cut.id]: { undo: [], redo: [] } },
    quickWins: 'new',
    options: { lightPreview: false, tour: true, bakeCamera: false, autoZoomed: false, ...options },
    updatedAt: rec.createdAt,
  };
}
