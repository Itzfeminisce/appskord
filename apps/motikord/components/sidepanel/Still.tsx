import { useEffect, useState } from 'react';
import type { KeyFrame } from '../../lib/pipeline/v3';
import { renderStill } from './stills';

/** One key frame: the worker's picture when there is one, else the scene's words on the look's ground. */
export function Still({ frame, ground, ink, font, label, width = 160, height = 284 }: {
  frame: KeyFrame; ground: string; ink: string; font: string; label: string; width?: number; height?: number;
}) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let live = true;
    setSrc(undefined);
    if (frame.still) void renderStill(frame.still, frame.atMs, { width, height }).then((url) => { if (live) setSrc(url); });
    return () => { live = false; };
  }, [frame.still, frame.atMs, width, height]);
  return (
    <span role="img" aria-label={label} style={{ position: 'relative', display: 'grid', placeItems: 'center', width: '100%', aspectRatio: `${width} / ${height}`, borderRadius: 10, overflow: 'hidden', background: ground, color: ink, font: `600 15px/1.15 '${font}', sans-serif`, textAlign: 'center', padding: 10, boxSizing: 'border-box' }}>
      {src ? <img src={src} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : frame.status === 'failed' ? null : frame.words}
    </span>
  );
}
