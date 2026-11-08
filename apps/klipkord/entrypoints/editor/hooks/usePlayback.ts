import { useCallback, useEffect, useRef, useState } from 'react';

export interface Playback {
  /** The playhead, output ms of the current cut. */
  out: number;
  playing: boolean;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(out: number): void;
}

/** Which frame `out` ms falls in at `fps`: playback re-renders only when this changes. */
export const frameIndex = (out: number, fps: number): number => Math.floor((out * fps) / 1000);

/** No per-project frame rate exists; exports run at 30 fps. */
const PREVIEW_FPS = 30;

/** The playhead in output time: advances with the clock while playing and stops at the end of the cut. */
export function usePlayback(length: number, enabled: boolean, fps = PREVIEW_FPS): Playback {
  const [out, setOut] = useState(0);
  const [playing, setPlaying] = useState(false);
  const outRef = useRef(0);
  const lengthRef = useRef(length);
  lengthRef.current = length;

  const seek = useCallback((t: number) => {
    const clamped = Math.max(0, Math.min(lengthRef.current, t));
    outRef.current = clamped;
    setOut(clamped);
  }, []);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(at: number) {
      const next = outRef.current + Math.max(0, at - last);
      last = at;
      if (next >= lengthRef.current) {
        seek(lengthRef.current);
        setPlaying(false);
        return;
      }
      const shown = frameIndex(outRef.current, fps);
      outRef.current = next;
      if (frameIndex(next, fps) !== shown) setOut(next);
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [playing, seek, fps]);

  // An edit can shorten the cut under the playhead.
  useEffect(() => { if (outRef.current > length) seek(length); }, [length, seek]);

  const play = useCallback(() => {
    if (!enabled || lengthRef.current <= 0) return;
    if (outRef.current >= lengthRef.current) seek(0);
    setPlaying(true);
  }, [enabled, seek]);
  const pause = useCallback(() => {
    setPlaying(false);
    setOut(outRef.current);
  }, []);

  return { out, playing, play, pause, toggle: () => (playing ? pause() : play()), seek };
}
