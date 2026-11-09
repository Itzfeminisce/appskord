import { onMessage } from '../../lib/messages';

// The side panel's hidden frame: draws v3 stills and quality-check frames, so three.js never loads in the panel itself.
const frames = () => import('../../lib/v3/frames');

onMessage({
  'render/still': async (m) => ({ url: await (await frames()).stillUrl(m.scene, m.atMs, m.size, m.look, m.texts) }),
  'render/frames': async (m) => ({ urls: await (await frames()).clipFramesFor((i, l) => m.texts[`${i}:${l.id}`], m.look)(m.clip, m.times) }),
});
