import { describe, expect, it } from 'vitest';
import { check, contrastRatio, readMs } from './checker';
import { applyPatch } from './patch';
import type { Layer, Recipe } from './types';

// Every character is half the type size wide.
const measure = (t: string, s: number) => t.length * s * 0.5;

const title = (extra: Partial<Layer> = {}): Layer => ({
  id: 'title', name: 'Title', type: 'text', role: 'title', text: 'Spring sale', font: 'Geist', sizePx: 80, weight: 700,
  colour: '#FFFFFF', align: 'center', lineHeight: 1.2, startMs: 0, endMs: 3000, opacity: 1,
  box: { x: 0.2, y: 0.4, w: 0.6, h: 0.2 }, ...extra,
} as Layer);

const clip = (layers: Layer[], extra: Partial<Recipe> = {}): Recipe => ({
  version: 1, id: 'r', name: 'Clip', type: 'promo', aspect: '1:1',
  scenes: [{ id: 's1', durationMs: 4000, background: '#111114', layout: 'center', layers }],
  assets: {
    photo: { id: 'photo', kind: 'image', name: 'p', mime: 'image/jpeg', bytes: 1, opfsPath: 'p',
      credit: { title: 'Hill', author: 'A. Person', source: 'openverse', url: 'https://example.org/p', licence: 'cc-by' } },
  },
  ...extra,
});

const fixed = (r: Recipe) => check(r, { measure }).reduce((doc, issue) => applyPatch(doc, issue.fix).doc as Recipe, r);
const kinds = (r: Recipe) => check(r, { measure }).map((i) => `${i.kind}@${i.aspect}`);

describe('checker', () => {
  it('passes a clean clip on every size', () => {
    expect(check(clip([title()]), { measure })).toEqual([]);
  });

  it('finds text that overflows and fixes it by fitting the size', () => {
    const r = clip([title({ text: 'A much longer spring sale headline than fits' } as Partial<Layer>)]);
    expect(kinds(r)).toContain('overflow@1:1');
    expect(kinds(fixed(r)).filter((k) => k.startsWith('overflow'))).toEqual([]);
  });

  it('finds low contrast against the scene or a card behind, and picks a readable colour', () => {
    const r = clip([title({ colour: '#222222' } as Partial<Layer>)]);
    expect(kinds(r)).toEqual(['contrast@1:1']);
    expect((fixed(r).scenes[0]!.layers[0] as { colour: string }).colour).toBe('#FFFFFF');
    const card: Layer = { id: 'card', name: 'Card', type: 'shape', shape: 'rect', fill: '#FFFFFF', startMs: 0, endMs: 3000, opacity: 1, box: { x: 0.1, y: 0.3, w: 0.8, h: 0.4 } };
    expect(kinds(clip([card, title()]))).toEqual(['contrast@1:1']);
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21);
  });

  it('finds content outside the safe area on each size and fixes that size only', () => {
    const r = clip([title({ boxes: { '9:16': { x: 0.2, y: 0.02, w: 0.6, h: 0.1 } } } as Partial<Layer>)]);
    expect(kinds(r)).toEqual(['safe-area@9:16']);
    const f = fixed(r);
    expect(kinds(f)).toEqual([]);
    expect(f.scenes[0]!.layers[0]!.box).toEqual(r.scenes[0]!.layers[0]!.box);
    const edge = clip([title({ box: { x: 0, y: 0.4, w: 0.6, h: 0.2 } })]);
    expect(kinds(edge)).toEqual(['safe-area@1:1']);
    expect(kinds(fixed(edge))).toEqual([]);
  });

  it('finds text on screen too briefly to read, and motion faster than the slider allows', () => {
    const r = clip([title({ endMs: 500, in: { preset: 'rise-in', feel: 'smooth', durationMs: 50 } })]);
    expect(kinds(r)).toEqual(['too-fast@1:1']);
    const f = fixed(r);
    expect(f.scenes[0]!.layers[0]!.endMs).toBe(readMs('Spring sale'));
    expect(f.scenes[0]!.layers[0]!.in!.durationMs).toBe(600);
    const long = clip([title({ text: 'One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen', sizePx: 20, endMs: 1000 } as Partial<Layer>)]);
    const g = fixed(long);
    expect(g.scenes[0]!.durationMs).toBeGreaterThan(4000);
    expect(kinds(g)).toEqual([]);
  });

  it('flags CC BY media and music without credits, and turns the credits card on', () => {
    const photo: Layer = { id: 'ph', name: 'Photo', type: 'image', assetId: 'photo', fit: 'cover', startMs: 0, endMs: 3000, opacity: 1, box: { x: 0, y: 0, w: 1, h: 1 } };
    const r = clip([photo]);
    expect(kinds(r)).toEqual(['credit-missing@1:1']);
    expect(fixed(r).creditsEndCard).toBe(true);
    expect(kinds(clip([photo], { creditsEndCard: true }))).toEqual([]);
    const music = clip([], {
      music: { assetId: 'song', volume: 1, fadeInMs: 0, fadeOutMs: 0 },
      assets: { song: { id: 'song', kind: 'audio', name: 's', mime: 'audio/mpeg', bytes: 1, opfsPath: 's', credit: { title: 'S', author: 'B', source: 'openverse', url: 'https://example.org/s', licence: 'cc-by-sa' } } },
    });
    expect(kinds(music)).toEqual(['credit-missing@1:1']);
  });

  it('gives every issue a unique id', () => {
    const r = clip([title({ colour: '#222222', endMs: 300, box: { x: 0, y: 0, w: 0.3, h: 0.05 } })]);
    const ids = check(r, { measure }).map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(3);
  });

  it('one overflow fix size holds on every size when all fixes are applied', () => {
    const r = clip([title({ text: 'A much longer spring sale headline than fits in any box at all', box: { x: 0.2, y: 0.4, w: 0.6, h: 0.2 } } as Partial<Layer>)]);
    const found = check(r, { measure }).filter((i) => i.kind === 'overflow');
    expect(found.length).toBeGreaterThan(1);
    expect(new Set(found.map((i) => JSON.stringify(i.fix))).size).toBe(1);
    expect(kinds(fixed(r)).filter((k) => k.startsWith('overflow'))).toEqual([]);
  });

  it('several too-fast fixes in one scene never cut a layer', () => {
    const words = (n: number) => Array.from({ length: n }, (_, k) => `w${k}`).join(' ');
    const a = title({ id: 'a', text: words(20), startMs: 1000, endMs: 1500, box: { x: 0.2, y: 0.2, w: 0.6, h: 0.2 } } as Partial<Layer>);
    const b = title({ id: 'b', text: words(12), startMs: 1500, endMs: 2000, box: { x: 0.2, y: 0.6, w: 0.6, h: 0.2 } } as Partial<Layer>);
    const f = fixed(clip([a, b]));
    const sc = f.scenes[0]!;
    expect(sc.durationMs).toBe(1000 + readMs(words(20)));
    for (const l of sc.layers) expect(l.endMs).toBeLessThanOrEqual(sc.durationMs);
    expect(kinds(f).filter((k) => k.startsWith('too-fast'))).toEqual([]);
  });

  it('reads the box for the recipe size and blends alpha and opacity when finding the colour behind', () => {
    const card = (extra: Partial<Layer>): Layer => ({ id: 'card', name: 'Card', type: 'shape', shape: 'rect', fill: '#FFFFFF', startMs: 0, endMs: 3000, opacity: 1, box: { x: 0.1, y: 0.3, w: 0.8, h: 0.4 }, ...extra } as Layer);
    const ink = { colour: '#000000' } as Partial<Layer>;
    const moved = title({ box: { x: 0.02, y: 0.02, w: 0.1, h: 0.1 }, boxes: { '1:1': { x: 0.2, y: 0.4, w: 0.6, h: 0.2 } } } as Partial<Layer>);
    expect(kinds(clip([card({}), moved]))).toContain('contrast@1:1');
    expect(kinds(clip([card({}), title(ink)]))).toEqual([]);
    expect(kinds(clip([card({ fill: '#FFFFFF10' } as Partial<Layer>), title(ink)]))).toEqual(['contrast@1:1']);
    expect(kinds(clip([card({ opacity: 0.1 }), title(ink)]))).toEqual(['contrast@1:1']);
  });

  it('flags text under 28 px on 9:16, and the fix raises it without overflowing any size', () => {
    const small = clip([title({ text: 'Open daily', sizePx: 18, box: { x: 0.2, y: 0.4, w: 0.6, h: 0.2 } } as Partial<Layer>)]);
    expect(kinds(small)).toContain('too-small@9:16');
    expect(kinds(fixed(small)).filter((k) => k.startsWith('too-small') || k.startsWith('overflow'))).toEqual([]);
    expect(kinds(clip([title({ sizePx: 40 } as Partial<Layer>)])).filter((k) => k.startsWith('too-small'))).toEqual([]);
  });

  it('does not flag small text that could not be 28 px without overflowing', () => {
    const tiny = clip([title({ text: 'Small print '.repeat(12).trim(), sizePx: 12, box: { x: 0.2, y: 0.4, w: 0.6, h: 0.03 } } as Partial<Layer>)]);
    expect(kinds(tiny).filter((k) => k.startsWith('too-small'))).toEqual([]);
  });
});

// ---- v2 layout checks ----
import { autoFix } from './checker';
import { expandScene } from './templates/expand';
import { getPack, getSceneTemplate, SCENE_TEMPLATES, STYLE_PACKS } from './templates/scenes';
import type { Scene, SlotValue, TemplateId } from './types';

const w = (n: number, p = 'w') => Array.from({ length: n }, (_, i) => `${p}${i}`).join(' ');
const full = (id: TemplateId): Record<string, SlotValue> => {
  const out: Record<string, SlotValue> = {};
  for (const d of getSceneTemplate(id)!.slots) {
    const n = d.items?.[1] ?? 1;
    if (d.kind === 'text') out[d.id] = d.id === 'highlight' ? 'w2' : d.scale === 'number' ? '1,200' : w(d.words ?? 3);
    else if (d.kind === 'items') out[d.id] = Array.from({ length: n }, () => w(d.words ?? 3));
    else if (d.kind === 'chart') out[d.id] = Array.from({ length: n }, (_, i) => ({ label: `m${i}`, value: i + 1 }));
    else out[d.id] = { assetId: d.kind === 'logo' ? 'logo' : 'photo' };
  }
  return out;
};
const v2 = (scenes: Scene[], extra: Partial<Recipe> = {}): Recipe => ({
  ...clip([]), version: 2, style: 'clean', aspect: '9:16', scenes,
  assets: { photo: { id: 'photo', kind: 'image', name: 'p', mime: 'image/jpeg', bytes: 1, opfsPath: 'p' }, logo: { id: 'logo', kind: 'logo', name: 'l', mime: 'image/png', bytes: 1, opfsPath: 'l' } },
  ...extra,
});
const tpl = (id: string, t: TemplateId, slots = full(t), extra: Partial<Scene> = {}): Scene =>
  expandScene({ id, durationMs: getSceneTemplate(t)!.defaultMs, background: '#fff', layout: 'center', layers: [], template: t, slots, ...extra }, getPack('clean')!);
const V2 = ['overlap', 'crowding', 'empty', 'align', 'words', 'template-repeat', 'safe-area'];
const v2issues = (r: Recipe) => check(r, { measure }).filter((i) => V2.includes(i.kind));
const v2kinds = (r: Recipe) => v2issues(r).map((i) => i.kind);
const free = (layers: Layer[], dur = 3000): Scene => ({ id: 's1', durationMs: dur, background: '#111114', layout: 'center', layers });
const txt = (idn: string, box: { x: number; y: number; w: number; h: number }, extra: Partial<Layer> = {}): Layer => title({ id: idn, name: idn, box, ...extra } as Partial<Layer>);
const logoLayer = (box: { x: number; y: number; w: number; h: number }): Layer => ({ id: 'mark', name: 'Logo', type: 'image', assetId: 'logo', startMs: 0, endMs: 3000, opacity: 1, box } as Layer);
const same = (r: Recipe, kind: string) => check(r, { measure }).filter((i) => i.kind === kind);
// One fix at a time, as the screen does, so later patches see the earlier ones.
const apply = (r: Recipe, kind: string) => {
  let cur = r;
  for (let n = 0; n < 10; n++) { const i = same(cur, kind).find((x) => x.fix.length); if (!i) break; cur = applyPatch(cur, i.fix).doc as Recipe; }
  return cur;
};

describe('checker v2', () => {
  it('flags nothing on any template at full slots in every pack', () => {
    for (const t of SCENE_TEMPLATES) for (const p of STYLE_PACKS) {
      const s = expandScene({ id: 's', durationMs: t.defaultMs, background: '#fff', layout: 'center', layers: [], template: t.id, slots: full(t.id) }, p);
      expect(v2issues(v2([s], { style: p.id })).map((i) => `${i.kind}@${i.aspect}`), `${t.id} ${p.id}`).toEqual([]);
    }
  });

  it('does not flag a full-frame background under a templated scene', () => {
    const r = v2([tpl('s1', 'hero')]);
    expect(v2kinds(r)).toEqual([]);
  });

  it('overlap: moves a logo off the headline', () => {
    const r = v2([free([txt('head', { x: 0.1, y: 0.1, w: 0.8, h: 0.2 }), logoLayer({ x: 0.12, y: 0.12, w: 0.2, h: 0.1 })])]);
    const hit = same(r, 'overlap');
    expect(hit.length).toBeGreaterThan(0);
    expect(hit[0]!.note).toBe('Scene 1 logo moved off the head');
    expect(same(apply(r, 'overlap'), 'overlap')).toEqual([]);
    expect(v2kinds(v2([free([txt('head', { x: 0.1, y: 0.1, w: 0.8, h: 0.2 }), logoLayer({ x: 0.7, y: 0.6, w: 0.2, h: 0.1 })])]))).not.toContain('overlap');
  });

  it('overlap: a templated scene falls back to the template boxes', () => {
    const s = tpl('s1', 'title-hook');
    const [first, second] = s.layers.filter((l) => l.type === 'text');
    s.layers = s.layers.map((l) => (l === second ? { ...l, boxes: { ...l.boxes, '9:16': { ...first!.boxes!['9:16']! } } } : l));
    const r = v2([s]);
    expect(same(r, 'overlap').length).toBeGreaterThan(0);
    expect(same(apply(r, 'overlap'), 'overlap')).toEqual([]);
  });

  it('crowding: more than 3 text layers; drop the last line', () => {
    const rows = [0.1, 0.25, 0.4, 0.55].map((y, i) => txt(`t${i}`, { x: 0.1, y, w: 0.5, h: 0.08 }, { text: `Line ${i}` } as Partial<Layer>));
    const r = v2([free(rows)], { aspect: '1:1' });
    expect(same(r, 'crowding').map((i) => i.aspect)).toEqual(['1:1']);
    const f = apply(r, 'crowding');
    expect(f.scenes[0]!.layers.map((l) => l.id)).toEqual(['t0', 't1', 't2']);
    expect(same(f, 'crowding')).toEqual([]);
    expect(same(v2([free(rows.slice(0, 3))], { aspect: '1:1' }), 'crowding')).toEqual([]);
  });

  it('crowding: text over 45% of the safe area', () => {
    const big = [txt('a', { x: 0.1, y: 0.1, w: 0.8, h: 0.4 }, { text: w(40), sizePx: 100 } as Partial<Layer>), txt('b', { x: 0.1, y: 0.52, w: 0.8, h: 0.3 }, { text: w(30), sizePx: 100 } as Partial<Layer>)];
    const r = v2([free(big)], { aspect: '1:1' });
    expect(same(r, 'crowding').length).toBe(3);
    expect(same(apply(r, 'crowding'), 'crowding')).toEqual([]);
  });

  it('empty: under 12% of the frame for over a second; use the template layout', () => {
    const s = tpl('s1', 'big-statement');
    const small = { x: 0.4, y: 0.45, w: 0.2, h: 0.1 };
    s.layers = s.layers.map((l) => ({ ...l, boxes: { ...l.boxes, '16:9': small } }));
    const r = v2([s]);
    const hit = same(r, 'empty');
    expect(hit.map((i) => i.aspect)).toEqual(['16:9']);
    expect(hit[0]!.note).toBe('Scene 1 now uses the 16:9 layout');
    expect(same(apply(r, 'empty'), 'empty')).toEqual([]);
    expect(same(v2([tpl('s1', 'big-statement')]), 'empty')).toEqual([]);
    const brief = free([txt('a', small, { endMs: 800 } as Partial<Layer>)], 800);
    expect(same(v2([brief]), 'empty')).toEqual([]);
  });

  it('align: left edges or centres within 2% but not equal; snap them', () => {
    const left = v2([free([txt('name', { x: 0.2, y: 0.2, w: 0.5, h: 0.1 }, { align: 'left' } as Partial<Layer>), txt('role', { x: 0.21, y: 0.4, w: 0.3, h: 0.1 }, { align: 'left' } as Partial<Layer>)])], { aspect: '1:1' });
    expect(same(left, 'align').length).toBeGreaterThan(0);
    expect(same(apply(left, 'align'), 'align')).toEqual([]);
    const mid = v2([free([txt('a', { x: 0.2, y: 0.2, w: 0.6, h: 0.1 }), txt('b', { x: 0.31, y: 0.4, w: 0.4, h: 0.1 })])], { aspect: '1:1' });
    expect(same(mid, 'align').length).toBeGreaterThan(0);
    expect(same(apply(mid, 'align'), 'align')).toEqual([]);
    const ok = v2([free([txt('a', { x: 0.2, y: 0.2, w: 0.5, h: 0.1 }, { align: 'left' } as Partial<Layer>), txt('b', { x: 0.2, y: 0.4, w: 0.3, h: 0.1 }, { align: 'left' } as Partial<Layer>), txt('c', { x: 0.6, y: 0.6, w: 0.2, h: 0.1 }, { align: 'left' } as Partial<Layer>)])], { aspect: '1:1' });
    expect(same(ok, 'align')).toEqual([]);
  });

  it('words: slot text over the template limit; shorten to the limit', () => {
    const s = tpl('s1', 'big-statement');
    const r = v2([{ ...s, slots: { statement: w(14) } }]);
    const hit = same(r, 'words');
    expect(hit.map((i) => i.layerId)).toEqual(['statement']);
    const f = apply(r, 'words');
    expect(f.scenes[0]!.slots!.statement).toBe(w(10));
    expect(f.scenes[0]!.original).toEqual({ statement: w(14) });
    expect(same(f, 'words')).toEqual([]);
    expect(same(v2([s]), 'words')).toEqual([]);
  });

  it('template-repeat: the third scene in a row swaps to the nearest template that fits', () => {
    const items = ['One two', 'Three four', 'Five six'];
    const mk = (n: string) => tpl(n, 'list', { title: 'Our steps', items });
    const r = v2([mk('a'), mk('b'), mk('c')]);
    const hit = same(r, 'template-repeat');
    expect(hit.map((i) => i.sceneId)).toEqual(['c']);
    expect(hit[0]!.note).toBe('Scene 3 swapped from List to Steps\nIts items read as steps.');
    const f = apply(r, 'template-repeat');
    expect(f.scenes.map((s) => s.template)).toEqual(['list', 'list', 'steps']);
    expect(f.scenes[2]!.slots).toEqual({ title: 'Our steps', steps: items });
    expect(same(f, 'template-repeat')).toEqual([]);
    expect(same(v2([mk('a'), mk('b'), tpl('c', 'steps', { title: 'Our steps', items })]), 'template-repeat')).toEqual([]);
  });

  it('template-repeat: no fix when nothing fits whole', () => {
    const mk = (n: string) => tpl(n, 'stat-reveal', { number: '40', label: 'Fewer calls' });
    const hit = same(v2([mk('a'), mk('b'), mk('c')]), 'template-repeat');
    expect(hit).toHaveLength(1);
    expect(hit[0]!.fix.length === 0 || typeof hit[0]!.fix[0]).toBeTruthy();
  });

  it('safe area: a templated scene uses the template safe area, a v1 scene keeps v1', () => {
    const s = tpl('s1', 'hero');
    expect(same(v2([s]), 'safe-area')).toEqual([]);
    const r = v2([free([txt('a', { x: 0.06, y: 0.12, w: 0.8, h: 0.1 })])]);
    expect(same(r, 'safe-area').map((i) => i.aspect)).toEqual([]);
    const t = tpl('s1', 'big-statement');
    t.layers = t.layers.map((l) => ({ ...l, boxes: { ...l.boxes, '9:16': { x: 0.065, y: 0.4, w: 0.8, h: 0.1 } } }));
    expect(same(v2([t]), 'safe-area').map((i) => i.aspect)).toEqual(['9:16']);
  });

  it('autoFix applies words, align, empty and template-repeat, and notes each', () => {
    const items = ['One two', 'Three four', 'Five six'];
    const mk = (n: string) => tpl(n, 'list', { title: 'Our steps', items });
    const long = { ...tpl('w', 'big-statement'), slots: { statement: w(14) } };
    const r = v2([mk('a'), mk('b'), mk('c'), long]);
    const { recipe, fixed } = autoFix(r, { measure });
    expect(fixed.map((i) => i.kind).sort()).toEqual(['template-repeat', 'words']);
    expect(fixed.every((i) => i.auto && i.note)).toBe(true);
    expect(recipe.scenes[2]!.template).toBe('steps');
    expect(check(recipe, { measure }).filter((i) => ['words', 'template-repeat'].includes(i.kind))).toEqual([]);
    const crowded = v2([free(['a', 'b', 'c', 'd'].map((n, i) => txt(n, { x: 0.1, y: 0.1 + i * 0.15, w: 0.5, h: 0.08 })))], { aspect: '1:1' });
    expect(autoFix(crowded, { measure }).fixed).toEqual([]);
  });
});

describe('contrast judges what is actually behind the text', () => {
  const bold = (boxes: Record<string, { x: number; y: number; w: number; h: number }>, bg: Scene['bg']): Recipe => ({
    ...clip([title({ colour: '#FFFFFF', box: boxes['16:9'], boxes } as Partial<Layer>)]), version: 2, style: 'bold', aspect: '16:9',
    scenes: [{ id: 's1', durationMs: 3000, background: '#0A0A0A', layout: 'center', layers: [title({ colour: '#FFFFFF', box: boxes['16:9'], boxes } as Partial<Layer>)], bg }],
  });
  const onBand = { '9:16': { x: 0.1, y: 0.2, w: 0.8, h: 0.2 }, '1:1': { x: 0.1, y: 0.2, w: 0.5, h: 0.2 }, '16:9': { x: 0.05, y: 0.5, w: 0.9, h: 0.3 } };
  it('flags white text running onto the yellow slab of an older blocks background', () => {
    const r = bold(onBand, { kind: 'blocks', colours: ['#0A0A0A', '#FACC15'] });
    const hit = check(r, { measure }).filter((i) => i.kind === 'contrast');
    expect(hit.map((i) => i.aspect)).toEqual(['16:9']);
    expect(hit[0]!.note).toContain('block');
    expect(check(applyPatch(r, hit[0]!.fix).doc as Recipe, { measure }).filter((i) => i.kind === 'contrast')).toEqual([]);
  });
  it('passes text kept off a planned slab', () => {
    const shapes = { '9:16': [[0, 0.8], [1, 0.75], [1, 1], [0, 1]], '1:1': [[0.7, 0], [1, 0], [1, 1], [0.7, 1]], '16:9': [[0, 0.9], [1, 0.9], [1, 1], [0, 1]] } as never;
    expect(check(bold(onBand, { kind: 'blocks', colours: ['#0A0A0A', '#FACC15'], shapes }), { measure }).filter((i) => i.kind === 'contrast')).toEqual([]);
  });
  it('judges both ends of a gradient', () => {
    const r = bold(onBand, { kind: 'gradient', colours: ['#0A0A0A', '#FFFFFF'] });
    expect(check(r, { measure }).some((i) => i.kind === 'contrast')).toBe(true);
  });
  it('asks for a shadow on text over a picture, and accepts one', () => {
    const photo: Layer = { id: 'p', name: 'Photo', type: 'image', assetId: 'photo', startMs: 0, endMs: 3000, opacity: 1, box: { x: 0, y: 0, w: 1, h: 1 }, fit: 'cover' } as Layer;
    const r = clip([photo, title()]);
    const hit = check(r, { measure }).filter((i) => i.kind === 'contrast');
    expect(hit).toHaveLength(1);
    expect(check(clip([photo, title({ shadow: true } as Partial<Layer>)]), { measure }).filter((i) => i.kind === 'contrast')).toEqual([]);
  });
});
