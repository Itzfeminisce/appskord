import type { Cut, Shape } from '../project/types';

/** The cut as this export draws it: the preset's shape, captions burned in or not, the camera shown or not. */
export function renderCut(cut: Cut, o: { shape?: Shape; burn?: boolean; camera?: boolean }): Cut {
  const tracks = o.camera === false ? { ...cut.tracks, camera: { ...cut.tracks.camera, hidden: true } } : cut.tracks;
  return {
    ...cut,
    shape: o.shape ?? cut.shape,
    captions: o.burn === undefined ? cut.captions : { ...cut.captions, show: o.burn },
    tracks,
  };
}
