import { useEffect, useState } from 'react';
import type { LookGuide } from '@appskord/motion/types';
import type { KeyFrame } from '../../lib/pipeline/v3';
import type { Scene } from '../../lib/types';
import { renderStill, sceneTexts } from './stills';

/** One key frame: the worker's picture when there is one, else the scene's words on the look's ground. */
export function Still({ frame, ground, ink, font, label, width = 160, height = 284, look, v2 }: {
  frame: KeyFrame; ground: string; ink: string; font: string; label: string; width?: number; height?: number;
  /** The look the still is drawn in, and the v2 scene its words come from. */
  look?: LookGuide; v2?: Scene;
}) {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    let live = true;
    setSrc(undefined);
    if (frame.still) void renderStill(frame.still, frame.atMs, { width, height }, { look, texts: sceneTexts(frame.still, v2) }).then((url) => { if (live) setSrc(url); });
    return () => { live = false; };
  }, [frame.still, frame.atMs, width, height, look, v2]);
  return (
    <span role="img" aria-label={label} style={{ position: 'relative', display: 'grid', placeItems: 'center', width: '100%', aspectRatio: `${width} / ${height}`, borderRadius: 10, overflow: 'hidden', background: ground, color: ink, font: `600 15px/1.15 '${font}', sans-serif`, textAlign: 'center', padding: 10, boxSizing: 'border-box' }}>
      {src ? <img src={src} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : frame.status === 'failed' ? null : frame.words}
    </span>
  );
}
