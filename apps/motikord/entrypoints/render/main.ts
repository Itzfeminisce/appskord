import { isPortHandoff, ownEntry, serveRenderPort } from '../../lib/v3/renderChannel';

// The side panel's hidden frame: draws v3 stills and quality-check frames, so three.js never loads in the panel itself.
// It answers only the port its parent panel hands it; runtime messages from elsewhere never reach it.
const frames = () => import('../../lib/v3/frames');

let served = false;
const onHandoff = (e: MessageEvent) => {
  if (served || !isPortHandoff(e, { origin: location.origin, parent: window.parent, window })) return;
  served = true;
  window.removeEventListener('message', onHandoff);
  serveRenderPort(e.ports[0]!, {
    still: async (m) => (await frames()).stillUrl(m.scene, m.atMs, m.size, m.look, m.contents),
    frames: async (m) => (await frames()).clipFramesFor((i, l) => ownEntry(m.contents, `${i}:${l.id}`), m.look)(m.clip, m.times),
  });
};
window.addEventListener('message', onHandoff);
