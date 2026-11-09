import type { ClipV3, SceneV3 } from '../src/types';

export const scene = (): SceneV3 => ({
  version: 3,
  id: 's1',
  templateId: 'hero-title',
  ms: 3000,
  layers: [
    {
      id: 'kicker',
      kind: 'text',
      depth: 'front',
      type: { unit: 'word' },
      tracks: {
        opacity: [
          { t: 0, v: 0 },
          { t: 360, v: 1 },
        ],
        y: [
          { t: 0, v: 40 },
          { t: 360, v: 0, curve: { kind: 'bezier', p: [0.2, 0, 0, 1] } },
        ],
      },
    },
    {
      id: 'headline',
      kind: 'text',
      depth: 'front',
      carry: 'word',
      tracks: {
        scale: [
          { t: 0, v: 0.6 },
          { t: 700, v: 1, curve: { kind: 'spring', bounce: 50, ms: 700 } },
        ],
        rotate: [
          { t: 0, v: -8 },
          { t: 600, v: 0 },
        ],
      },
    },
    {
      id: 'blob',
      kind: 'shape',
      depth: 'back',
      z: -4,
      start: 0,
      tracks: {
        x: [
          { t: 0, v: -200 },
          { t: 3000, v: 200 },
        ],
      },
    },
  ],
  camera: { move: 'push-in', amount: 0.4, focus: 'headline' },
  transition: { kind: 'carry', carry: ['word'] },
});

export const clip = (): ClipV3 => {
  const next = scene();
  next.id = 's2';
  next.transition = { kind: 'cut' };
  return {
    version: 3,
    scenes: [scene(), next],
    lookGuideId: 'g1',
    packId: 'studio',
    fps: 30,
    finish: { on: true, blur: 0.5, light: 0.4, grain: 0.2, grade: 0.3 },
  };
};
