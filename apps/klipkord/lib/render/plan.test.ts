import { describe, expect, it } from 'vitest';
import type { Recording } from '../types';
import { captionLines } from '../project/captions';
import { currentCut } from '../project/history';
import { fromRecording } from '../project/migrate';
import type { Box, Cut, EventsTrack, Project, RecEvent, Source } from '../project/types';
import { autoZoom } from '../project/autoZoom';
import { arrange, cursorAt, FRAME, layoutAt, renderPlan } from './plan';

const click = (t: number, x: number, y: number): RecEvent => ({ t, type: 'click', x, y });
import { ease, MAX_ZOOM_RATE } from './spring';

const src = (id: string, kind: Source['kind'], w: number, h: number): Source =>
  ({ id, kind, file: `${id}.webm`, mime: 'video/webm', offset: 0, duration: 10_000, width: w, height: h, video: true, audio: false });
const rec = { id: 'r', title: 'Demo', createdAt: 1, duration: 10_000, mime: 'video/webm', quality: '1080p', edits: [], transcript: [], v3: { sources: ['screen', 'camera'], events: true } } as unknown as Recording;

/** 0..4000 at 1x, a 1000 ms gap, 6000..10000 at 2x with a 500 ms fade in. Output length 7000. */
function setup(change: Partial<Cut> = {}): { project: Project; cut: Cut } {
  const project = fromRecording(rec, [src('screen', 'screen', 1920, 1080), src('camera', 'camera', 640, 480)]);
  const cut: Cut = {
    ...currentCut(project),
    // The box maths below is written for this frame, not the design default.
    look: { ...currentCut(project).look, padding: 48, corners: 16 },
    clips: [
      { id: 'a', in: 0, out: 4000, speed: 1 },
      { id: 'g', in: 0, out: 1000, speed: 1, gap: true },
      { id: 'b', in: 6000, out: 10_000, speed: 2, transition: { kind: 'fade', ms: 500 } },
    ],
    ...change,
  };
  return { project: { ...project, cuts: [cut] }, cut };
}
const inside = (b: Box, W: number, H: number) => b.x >= -0.01 && b.y >= -0.01 && b.x + b.w <= W + 0.01 && b.y + b.h <= H + 0.01;

describe('renderPlan', () => {
  it('draws the screen and the bubble at the first frame', () => {
    const { project, cut } = setup();
    const plan = renderPlan(project, cut, 0);
    expect(plan).toMatchObject({ out: 0, rec: 0, fade: 0, overlays: [], cards: [], background: cut.look.background });
    expect(plan.screen).toMatchObject({ source: 'screen', t: 0, crop: { x: 0, y: 0, w: 1, h: 1 }, radius: 16, shadow: 24 });
    expect(plan.screen!.dest.h).toBe(984);
    expect(plan.screen!.dest.w).toBeCloseTo(984 * 16 / 9);
    expect(plan.camera).toMatchObject({ source: 'camera', t: 0, dest: { x: 40, y: 651, w: 389, h: 389 }, shape: 'round', alpha: 1 });
  });

  it('switches clips at their edges, shows the background in a gap and nothing past the end', () => {
    const { project, cut } = setup();
    expect(renderPlan(project, cut, 3999).rec).toBe(3999);
    const gap = renderPlan(project, cut, 4000);
    expect(gap.rec).toBeNull();
    expect(gap.screen).toBeUndefined();
    expect(gap.camera).toBeUndefined();
    expect(gap.background).toEqual(cut.look.background);
    const edge = renderPlan(project, cut, 5000);
    expect(edge).toMatchObject({ rec: 6000, fade: 1 });
    expect(renderPlan(project, cut, 5250)).toMatchObject({ rec: 6500, fade: 0.5 });
    expect(renderPlan(project, cut, 5500).fade).toBe(0);
    expect(renderPlan(project, cut, 6999).rec).toBe(9998);
    expect(renderPlan(project, cut, 7000).rec).toBeNull();
    expect(renderPlan(project, cut, -5).rec).toBeNull();
  });

  it('eases a zoom in and out towards its focus', () => {
    const { project, cut } = setup({ zooms: [{ id: 'z', at: 1000, end: 3000, depth: 2, focus: { x: 0.9, y: 0.9 }, feel: 'smooth', auto: true }] });
    expect(renderPlan(project, cut, 2000).screen!.crop).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    expect(renderPlan(project, cut, 1300).screen!.crop.w).toBeCloseTo(1 / 2 ** ease(0.5));
    expect(renderPlan(project, cut, 2700).screen!.crop.w).toBeCloseTo(1 / 2 ** ease(0.5));
    expect(renderPlan(project, cut, 3500).screen!.crop.w).toBe(1);
    const hidden = { ...cut, tracks: { zooms: { hidden: true } } };
    expect(renderPlan(project, hidden, 2000).screen!.crop.w).toBe(1);
  });

  it('zooms in on the cursor no faster than the cap and keeps the cursor on its spot', () => {
    const events: EventsTrack = { version: 1, viewport: { w: 1920, h: 1080 }, events: [{ t: 0, type: 'move', x: 0.8, y: 0.3 }] };
    const { project, cut } = setup({ zooms: [{ id: 'z', at: 500, end: 3000, depth: 2.5, focus: 'cursor', feel: 'snappy', auto: true }] });
    let prev = 1;
    let fastest = 0;
    for (let out = 500; out <= 1500; out += 5) {
      const plan = renderPlan(project, cut, out, events);
      const { crop, dest } = plan.screen!;
      const scale = 1 / crop.w;
      expect(scale).toBeGreaterThanOrEqual(prev - 1e-9);
      fastest = Math.max(fastest, Math.log(scale / prev) / 0.005);
      prev = scale;
      expect(plan.cursor!.x).toBeCloseTo(dest.x + ((0.8 - crop.x) / crop.w) * dest.w);
    }
    expect(prev).toBeCloseTo(2.5);
    expect(fastest).toBeLessThanOrEqual(MAX_ZOOM_RATE * 1.01);
    expect(fastest).toBeGreaterThan(MAX_ZOOM_RATE * 0.9);
  });

  it('pans between neighbouring zooms 600 ms apart without zooming out, fully in at each click', () => {
    const zooms = autoZoom([click(1000, 0.1, 0.1), click(1600, 0.9, 0.9)]);
    const { project, cut } = setup({ zooms });
    const depth = zooms[1]!.depth;
    expect(renderPlan(project, cut, 1000).screen!.crop).toMatchObject({ x: 0, y: 0, w: expect.closeTo(1 / depth) });
    expect(renderPlan(project, cut, 1600).screen!.crop).toMatchObject({ x: expect.closeTo(1 - 1 / depth), w: expect.closeTo(1 / depth) });
    for (let out = 1000; out <= 1600; out += 20) expect(renderPlan(project, cut, out).screen!.crop.w).toBeCloseTo(1 / depth);
  });

  it('is fully in at a click with less time than the ramp, at the start and near the end', () => {
    const early = setup({ zooms: autoZoom([click(100, 0.5, 0.5)], 'smooth', 4000) });
    expect(renderPlan(early.project, early.cut, 100).screen!.crop.w).toBeCloseTo(1 / early.cut.zooms[0]!.depth);
    const late = setup({ zooms: autoZoom([click(3900, 0.5, 0.5)], 'smooth', 4000) });
    expect(renderPlan(late.project, late.cut, 3900).screen!.crop.w).toBeCloseTo(1 / late.cut.zooms[0]!.depth);
    expect(renderPlan(late.project, late.cut, 3999).screen!.crop.w).toBeGreaterThan(0.9);
  });

  it('follows layout switches, smoothly fading the camera out', () => {
    const { project, cut } = setup({
      layouts: [{ id: 's', at: 0, layout: 'side', switch: 'cut' }, { id: 'o', at: 2000, layout: 'screen', switch: 'smooth' }],
    });
    const side = renderPlan(project, cut, 1000);
    expect(side.camera!.dest.x).toBeGreaterThan(side.screen!.dest.x + side.screen!.dest.w);
    expect(layoutAt(cut, 2200, true)).toEqual({ from: 'side', to: 'screen', progress: ease(0.5) });
    expect(renderPlan(project, cut, 2200).camera!.alpha).toBeCloseTo(1 - ease(0.5));
    expect(renderPlan(project, cut, 3000).camera).toBeUndefined();
    const full = setup({ layouts: [{ id: 'c', at: 0, layout: 'camera', switch: 'cut' }] });
    const cam = renderPlan(full.project, full.cut, 100);
    expect(cam.screen).toBeUndefined();
    expect(cam.camera!.dest).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it('blends the round bubble into rounded corners during a smooth switch', () => {
    const { project, cut } = setup({
      layouts: [{ id: 'b', at: 0, layout: 'bubble', switch: 'cut' }, { id: 's', at: 2000, layout: 'side', switch: 'smooth' }],
    });
    expect(renderPlan(project, cut, 1000).camera!.round).toBeUndefined();
    expect(renderPlan(project, cut, 2200).camera!.round).toBeCloseTo(1 - ease(0.5));
    const after = renderPlan(project, cut, 3500).camera!;
    expect(after.shape).toBe('rounded');
    expect(after.round).toBeUndefined();
  });

  it('places the cursor through the crop and rings clicks', () => {
    const events: EventsTrack = { version: 1, viewport: { w: 1920, h: 1080 }, events: [
      { t: 0, type: 'move', x: 0.5, y: 0.5 }, { t: 1000, type: 'click', x: 0.75, y: 0.5 }, { t: 1100, type: 'key', key: 'typing' },
    ] };
    expect(cursorAt(events.events, 500, true)).toEqual({ x: 0.5, y: 0.5, click: 0 });
    expect(cursorAt(events.events, 500, false)).toMatchObject({ x: 0.5 });
    expect(cursorAt(events.events, 1250, true)).toMatchObject({ y: 0.5, click: 0.5 });
    expect(cursorAt(events.events, 1250, true)!.x).toBeCloseTo(0.75, 3);
    expect(cursorAt(events.events, -1, true)).toBeNull();
    const mixed: RecEvent[] = [{ t: 0, type: 'move', x: 0, y: 0 }, { t: 100, type: 'scroll', dy: 0.1 }, { t: 200, type: 'page' }, { t: 1000, type: 'move', x: 1, y: 1 }];
    expect(cursorAt(mixed, 500, true)).toEqual({ x: 0, y: 0, click: 0 });
    expect(cursorAt(mixed, 2000, true)!.x).toBeCloseTo(1, 3);
    const { project, cut } = setup();
    const plan = renderPlan(project, cut, 1250, events);
    const d = plan.screen!.dest;
    expect(plan.cursor!.x).toBeCloseTo(d.x + 0.75 * d.w, 1);
    expect(plan.cursor).toMatchObject({ size: 1, click: 0.5, ring: { x: expect.closeTo(d.x + 0.75 * d.w), y: expect.closeTo(d.y + 0.5 * d.h) } });
    expect(renderPlan({ ...project, events: false }, cut, 1250, events).cursor).toBeUndefined();
  });

  it('shows overlays, cards, captions and media while they are on', () => {
    const units = ['Pick', 'a', 'role.'].map((text, i) => ({ start: 500 + i * 300, end: 750 + i * 300, text, line: 0 }));
    const { project, cut } = setup({
      overlays: [{ id: 'o', kind: 'text', at: 1000, end: 2000, box: { x: 0, y: 0, w: 1, h: 1 }, text: 'Hi', motion: 'fade' }],
      cards: [{ id: 'c', template: 'title', at: 6000, ms: 1000, slots: {}, pack: 'clean' }],
      media: [{ id: 'm', source: 'clip', at: 1000, trim: [200, 700], volume: 1, muted: false }],
      captions: { style: 'word', position: 'bottom', size: 48, show: true },
    });
    const caps = captionLines(units);
    const a = renderPlan(project, cut, 1050, undefined, caps);
    expect(a.overlays.map((o) => o.id)).toEqual(['o']);
    expect(a.media).toEqual({ source: 'clip', t: 250 });
    expect(a.captions?.words).toEqual([{ text: 'Pick', on: true }, { text: 'a', on: true }, { text: 'role.', on: false }]);
    expect(renderPlan(project, cut, 5500).cards.map((c) => c.id)).toEqual(['c']);
    expect(renderPlan(project, cut, 6000).cards).toEqual([]);
    expect(renderPlan(project, { ...cut, tracks: { overlays: { hidden: true } } }, 1100).overlays).toEqual([]);
    expect(renderPlan(project, { ...cut, captions: { ...cut.captions, show: false } }, 1100, undefined, caps).captions).toBeUndefined();
    const es = { ...cut, captions: { ...cut.captions, language: 'Spanish' } };
    expect(renderPlan({ ...project, translations: { Spanish: ['Elige un rol.'] } }, es, 1050, undefined, caps).captions?.words.map((w) => w.text)).toEqual(['Elige', 'un', 'rol.']);
  });
  it('moves a blur that follows the page with the scroll of a tab recording', () => {
    const { project, cut } = setup({
      overlays: [{ id: 'b', kind: 'blur', at: 0, end: 2000, box: { x: 0.1, y: 0.5, w: 0.2, h: 0.1 }, motion: 'none', blur: { mode: 'blur', amount: 0.6, follow: true } }],
    });
    const scroll: EventsTrack = { version: 1, viewport: { w: 1280, h: 720 }, events: [{ t: 500, type: 'scroll', dy: 0.25 }] };
    expect(renderPlan(project, cut, 1000, scroll).overlays[0]!.box.y).toBeCloseTo(0.25);
    expect(renderPlan({ ...project, events: false }, cut, 1000, scroll).overlays[0]!.box.y).toBe(0.5);
  });
});

describe('arrange', () => {
  const { cut } = setup();
  const base = { look: cut.look, camera: cut.camera, screenAspect: 16 / 9, cameraAspect: 4 / 3 };

  it('fits every shape and layout inside the frame', () => {
    for (const shape of ['16:9', '9:16', '1:1', '4:5'] as const) {
      for (const fit of ['stack', 'follow', 'bars'] as const) {
        for (const layout of ['bubble', 'side', 'camera', 'screen'] as const) {
          const { w, h } = FRAME[shape];
          const a = arrange({ ...base, shape, fit, layout });
          if (a.screen) expect(inside(a.screen, w, h)).toBe(true);
          if (a.camera) expect(inside(a.camera, w, h)).toBe(true);
        }
      }
    }
  });

  it('puts the camera under the screen in "Screen over camera"', () => {
    const a = arrange({ ...base, shape: '9:16', fit: 'stack', layout: 'bubble' });
    expect(a).toMatchObject({ follow: true, edge: true, screen: { x: 0, y: 0, w: 1080, h: 1114 }, camera: { x: 0, y: 1114, w: 1080, h: 806 } });
    const tall = setup({ shape: '9:16', fit: 'stack' });
    const plan = renderPlan(tall.project, tall.cut, 100);
    expect(plan.screen).toMatchObject({ radius: 0, shadow: 0 });
    expect(plan.camera).toMatchObject({ edge: true });
  });

  it('fills a tall frame and crops around the cursor in "Follow the cursor"', () => {
    const a = arrange({ ...base, shape: '9:16', fit: 'follow', layout: 'screen' });
    expect(a).toMatchObject({ follow: true, screen: { x: 48, y: 48, w: 984, h: 1824 } });
    const { project } = setup();
    const tall = setup({ shape: '9:16', fit: 'follow', layouts: [{ id: 'l', at: 0, layout: 'screen', switch: 'cut' }] });
    const events: EventsTrack = { version: 1, viewport: { w: 1, h: 1 }, events: [{ t: 0, type: 'move', x: 0.9, y: 0.5 }] };
    const crop = renderPlan(project, tall.cut, 100, events).screen!.crop;
    expect((crop.w * 16 / 9) / crop.h).toBeCloseTo(984 / 1824);
    expect(crop.x + crop.w).toBeCloseTo(1);
  });

  it('letterboxes in "Fit with bars", 1:1 and 4:5', () => {
    for (const shape of ['9:16', '1:1', '4:5'] as const) {
      const a = arrange({ ...base, shape, fit: 'bars', layout: 'screen' });
      expect(a.screen!.w).toBe(FRAME[shape].w - 96);
      expect(a.screen!.w / a.screen!.h).toBeCloseTo(16 / 9);
    }
  });
});
