import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';

// troika needs a DOM and fonts; a stand-in Text keeps the graph testable in Node.
vi.mock('../src/text', () => ({
  Text: class extends THREE.Object3D {
    clipRect: unknown = null;
    fillOpacity = 1;
    color = '';
    sync = vi.fn();
    dispose = vi.fn();
  },
}));

import { bakeParticles, PARTICLE_DEFAULTS } from '../src/particles';
import { V3Renderer } from '../src/renderer';
import { clip, scene } from './fixture';

const look = {
  id: 'g',
  name: 'Studio',
  palette: ['#0B0B10', '#F5F5F7', '#8B9CFF', '#1A1B2E', '#8E90A0'],
  type: { display: 'Geist', text: 'Geist' },
  feel: 'smooth' as const,
  light: 'left' as const,
  texture: 0.2,
  camera: 'push-in' as const,
};

describe('V3Renderer', () => {
  it('builds the graph, content and finish chain and poses every frame without a GPU', () => {
    const s = scene();
    s.effects = [{ effect: 'glow', amount: 0.6, scope: 'layer', sceneId: s.id, layerId: 'headline' }];
    const r = new V3Renderer(s, {
      width: 1080,
      height: 1920,
      quality: 'reduced',
      fps: 30,
      fontUrl: '/fonts/geist.woff2',
      finish: clip().finish,
      look,
      content: (l) =>
        l.kind === 'text' ? { text: l.id === 'headline' ? 'Notes that\nfind you.' : 'INTRODUCING' } : undefined,
    });
    expect(r.graph.layers.size).toBe(s.layers.length);
    expect(r.chain.plan.blur?.samples).toBe(5);
    for (const t of [0, 400, 1500, 3000]) {
      const f = r.pose(t);
      expect(f.t).toBe(t);
    }
    expect(r.graph.layers.get('headline')!.children).toHaveLength(1);
    expect(() => r.render(0)).toThrow(/attach/);
    r.dispose();
  });

  it('shows saved particles and spreads depth for Show depth', async () => {
    const s = scene();
    const settings = { ...PARTICLE_DEFAULTS, bounce: false, amount: 20 };
    const bake = await bakeParticles({ settings, seed: 3, ms: 1000, fps: 30 });
    s.layers.push({
      id: 'p',
      kind: 'particles',
      depth: 'middle',
      start: 0,
      seed: 3,
      tracks: {},
      particles: { ...settings, bake },
    });
    const r = new V3Renderer(s, {
      width: 540,
      height: 960,
      quality: 'reduced',
      fps: 30,
      fontUrl: '/f.woff2',
      spread: true,
    });
    r.pose(500);
    expect(r.graph.depths.back.position.z).toBeLessThan(0);
    expect(r.graph.layers.get('p')!.children[0]).toBeInstanceOf(THREE.Points);
    r.dispose();
  });
});
