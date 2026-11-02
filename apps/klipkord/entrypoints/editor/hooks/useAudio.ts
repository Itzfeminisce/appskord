import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { LiveMix } from '@/lib/audio/live';
import { mixPlan, type MixPlan } from '@/lib/audio/mix';
import type { Cut, Project } from '@/lib/project/types';
import type { Word } from '@/lib/types';
import type { EditorDeps } from '../deps';

/** Off by more than this, the playhead was moved: the sound restarts there. */
export const DRIFT_MS = 250;
/** Edits settle this long before the mix is measured again. */
export const MEASURE_AFTER_MS = 800;

/** What the loudness meter shows: the mix's loudness, measured while the Audio tab or "Even out the loudness" needs it. */
let meter: { key: string; lufs: number | null } = { key: '', lufs: null };
let wanted = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The measured loudness in LUFS, or null until it is known; measuring runs while a caller is mounted. */
export function useLoudness(): number | null {
  useEffect(() => {
    wanted++;
    notify();
    return () => {
      wanted--;
      notify();
    };
  }, []);
  return useSyncExternalStore(subscribe, () => meter.lufs, () => meter.lufs);
}

/** The plan's measure key: what changes its loudness before the level gain. */
export const measureKey = (plan: MixPlan): string => JSON.stringify({ ...plan, level: false, denoise: false });

/** True when the playhead is no longer where the sound started plus the time since: a seek. */
export const moved = (started: { out: number; at: number }, out: number, now: number): boolean =>
  Math.abs(out - (started.out + (now - started.at))) > DRIFT_MS;

/** Plays the cut's live mix (voice, tab, takes, media, music) in step with the playhead, through lib/audio. */
export function useAudio(project: Project | undefined, cut: Cut | undefined, words: Word[], blobs: Map<string, Blob> | undefined,
  out: number, playing: boolean, make: EditorDeps['mix']): void {
  // One engine, context and decode cache for the editor's life: files it already read are kept when sources change.
  const blobsRef = useRef(blobs);
  blobsRef.current = blobs;
  const engine = useMemo<LiveMix | null>(() => make((id) => blobsRef.current?.get(id) ?? null), [make]);
  useEffect(() => () => engine?.dispose(), [engine]);

  // One plan per real change: zoom or caption edits leave the sound alone.
  const built = useMemo(() => (project && cut ? mixPlan(project, cut, words) : null), [project?.sources, cut, words]); // eslint-disable-line react-hooks/exhaustive-deps
  const key = built ? JSON.stringify(built) : '';
  const plan = useMemo(() => built, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const outRef = useRef(out);
  outRef.current = out;
  const started = useRef<{ out: number; at: number } | null>(null);
  const [restart, setRestart] = useState(0);
  const want = useSyncExternalStore(subscribe, () => wanted > 0, () => false);
  const measured = useSyncExternalStore(subscribe, () => meter, () => meter);
  const lufsRef = useRef(measured.lufs);
  lufsRef.current = measured.lufs;
  // With "Even out the loudness" on, the sound restarts once its level gain is known.
  const levelKnown = !plan?.level || measured.key === measureKey(plan);

  useEffect(() => {
    if (!engine || !plan || !playing || !blobs) {
      started.current = null;
      return;
    }
    engine.play(plan, () => outRef.current, lufsRef.current);
    started.current = { out: outRef.current, at: performance.now() };
    return () => engine.stop();
  }, [engine, plan, playing, restart, levelKnown, blobs]);

  useEffect(() => {
    if (playing && started.current && moved(started.current, out, performance.now())) setRestart((k) => k + 1);
  }, [out, playing]);

  useEffect(() => {
    // Sources are measured once per file; after that an edit only sums their powers again.
    if (!engine || !plan || !blobs || !(want || plan.level)) return;
    const k = measureKey(plan);
    if (meter.key === k) return;
    let gone = false;
    const timer = setTimeout(() => {
      engine.measure(plan, () => gone).then((value) => {
        if (gone) return;
        meter = { key: k, lufs: value };
        notify();
      }, (error: unknown) => console.error('Klipkord: could not measure the loudness', error));
    }, MEASURE_AFTER_MS);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [engine, plan, want, blobs]);
}
