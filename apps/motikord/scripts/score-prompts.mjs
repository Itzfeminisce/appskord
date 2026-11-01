// Scores the AI on test/prompts.json: clip type detected, recipe valid, checker passes on the raw reply,
// and design: scene count for the type, 3-7 word headlines, varied layouts, in and out motion on every text.
// Exits 1 when the valid, checker or design rate falls below these thresholds.
const VALID_MIN = 0.9;
const CHECKER_MIN = 0.7;
const DESIGN_MIN = 0.7;
// Default: a fake Groq (CI, no network). Live: MOTIKORD_GROQ_KEY=<key> node scripts/score-prompts.mjs --live
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const live = process.argv.includes('--live');
const prompts = JSON.parse(await readFile(new URL('../test/prompts.json', import.meta.url), 'utf8'));

const server = await createServer({ root, configFile: false, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true } });
let exitCode = 0;
try {
  const { detectType } = await server.ssrLoadModule('/lib/ai/detectType.ts');
  const { writeRecipe } = await server.ssrLoadModule('/lib/ai/writeRecipe.ts');
  const { SCENE_RANGE } = await server.ssrLoadModule('/lib/ai/prompts.ts');

  const key = live ? process.env.MOTIKORD_GROQ_KEY : 'gsk_test';
  if (!key) throw new Error('Set MOTIKORD_GROQ_KEY for a live run.');
  const opts = { ai: 'cloud', key, fetch: live ? (u, i) => fetch(u, i) : fakeGroq(prompts) };

  const rows = [];
  for (const p of prompts) {
    const row = { id: p.id, want: p.type, got: '-', valid: false, checker: false, design: [], note: '' };
    try {
      row.got = (await detectType(p.prompt, { ...opts, settings: {} })).type;
      const out = await writeRecipe({ prompt: p.prompt, type: p.type, aspect: p.aspect, assets: [], id: p.id }, opts);
      row.valid = true;
      row.checker = out.checkerClean;
      row.design = designMisses(out.recipe, SCENE_RANGE);
      row.note = out.notices.join(' ');
    } catch (e) {
      row.note = e?.state ?? e?.code ?? 'error';
    }
    rows.push(row);
  }

  const yes = (b) => (b ? 'yes' : 'no');
  const designed = (r) => r.valid && r.design.length === 0;
  const table = [['prompt', 'type', 'detected', 'valid', 'checker', 'design', 'note'], ...rows.map((r) => [r.id, r.want, r.got, yes(r.valid), yes(r.checker), designed(r) ? 'yes' : r.design.join(',') || 'no', r.note])];
  const widths = table[0].map((_, c) => Math.max(...table.map((r) => String(r[c]).length)));
  for (const r of table) console.log(r.map((v, c) => String(v).padEnd(widths[c])).join('  '));
  const rate = (f) => rows.filter(f).length / rows.length;
  const valid = rate((r) => r.valid);
  const checker = rate((r) => r.checker);
  const detected = rate((r) => r.got === r.want);
  const design = rate(designed);
  const pct = (x) => `${Math.round(x * 100)}%`;
  console.log(`\n${live ? 'live' : 'fake'} | detected ${pct(detected)} | valid ${pct(valid)} (min ${pct(VALID_MIN)}) | checker ${pct(checker)} (min ${pct(CHECKER_MIN)}) | design ${pct(design)} (min ${pct(DESIGN_MIN)})`);
  if (valid < VALID_MIN || checker < CHECKER_MIN || design < DESIGN_MIN) exitCode = 1;
} catch (e) {
  console.error('Motikord: could not score prompts', e instanceof Error ? e.message : e);
  exitCode = 1;
} finally {
  await server.close();
}
process.exit(exitCode);

/** The design rules a recipe misses: scenes, headline, layouts, motion. */
function designMisses(recipe, range) {
  const misses = [];
  const [lo, hi] = range[recipe.type];
  const n = recipe.scenes.length;
  if (n < lo || n > hi) misses.push('scenes');
  const texts = recipe.scenes.flatMap((s) => s.layers.filter((l) => l.type === 'text'));
  const count = (t) => t.split(/\s+/).filter(Boolean).length;
  if (recipe.type !== 'quote' && recipe.type !== 'captions' && texts.some((l) => l.role === 'title' && (count(l.text) < 2 || count(l.text) > 7))) misses.push('headline');
  if (n >= 3 && new Set(recipe.scenes.map((s) => s.layout)).size < 2) misses.push('layouts');
  if (texts.some((l) => !l.in || !l.out)) misses.push('motion');
  return misses;
}

/** A fake Groq that answers like a well-behaved model, so CI checks the pipeline end to end without network. */
function fakeGroq(list) {
  const byPrompt = new Map(list.map((p) => [p.prompt, p]));
  return async (_url, init) => {
    if (!init?.body) return new Response('{"data":[]}', { status: 200 });
    const { messages } = JSON.parse(init.body);
    const system = messages[0].content;
    const user = messages[1].content;
    let content;
    if (system.startsWith('You sort')) content = JSON.stringify({ type: byPrompt.get(user)?.type ?? 'social' });
    else if (system.startsWith('You plan')) content = JSON.stringify(fakePlan(byPrompt.get(user)));
    else {
      const plan = /Design plan, follow it scene by scene: (.*)$/s.exec(user)?.[1];
      content = JSON.stringify(fakeDraft(byPrompt.get(user.split('\n')[0].replace(/^Idea: /, '')), plan ? JSON.parse(plan) : undefined));
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
  };
}

function fakePlan(p) {
  // Inside the function: the scoring loop above runs before module-level consts here exist.
  const SCENES = { promo: 5, social: 4, explainer: 5, chart: 3, captions: 3, quote: 2, logo: 2 };
  const BEATS = ['Meet %', 'Made for you', 'Why % matters', 'See the difference', 'Ready when you are', 'Starts today', 'Try % now'];
  const LAYOUTS = ['center', 'top', 'split', 'lower-third', 'bottom', 'center', 'top'];
  const PALETTE = [['#111114', '#F472B6'], ['#FFFFFF', '#BE185D'], ['#0F172A', '#F59E0B'], ['#FCE7F3', '#111114']];
  const words = (p?.prompt ?? 'Hello there').replace(/["“”:]/g, '').split(/\s+/);
  const key = words.slice(0, 2).join(' ');
  const n = SCENES[p?.type] ?? 4;
  const quoted = p?.type === 'quote' || p?.type === 'captions';
  return {
    name: key, hook: BEATS[0].replace('%', key),
    scenes: Array.from({ length: n }, (_, i) => ({
      ms: 3000, headline: quoted && i === 0 ? words.slice(0, 7).join(' ') : BEATS[i % BEATS.length].replace('%', key),
      support: i === 0 ? '' : words.slice(2, 5).join(' '), visual: i % 2 ? 'card behind text' : 'accent circle',
      layout: LAYOUTS[i], bg: PALETTE[i % 4][0], accent: PALETTE[i % 4][1], motion: 'pop-in bouncy, pulse, fade-out',
    })),
  };
}

function fakeDraft(p, plan = fakePlan(p)) {
  const ins = ['pop-in', 'rise-in', 'slide-in', 'blur-in', 'drop-in'];
  const outs = ['fade-out', 'rise-out', 'slide-out', 'pop-out'];
  const dark = (hex) => parseInt(hex.slice(1, 3), 16) < 128;
  const text = (id, role, t, y, sizePx, colour, startMs, endMs, i) => ({
    id, name: role, type: 'text', role, text: t, sizePx, weight: role === 'title' ? 800 : 500, colour,
    startMs, endMs, box: { x: 0.1, y, w: 0.8, h: role === 'title' ? 0.2 : 0.1 },
    in: { preset: ins[i % ins.length], feel: i % 2 ? 'snappy' : 'bouncy', durationMs: 600 }, out: { preset: outs[i % outs.length], feel: 'smooth', durationMs: 400 },
  });
  const scenes = plan.scenes.map((sc, i) => {
    const ms = Math.max(2000, Math.min(4000, sc.ms ?? 3000));
    const bg = sc.bg ?? '#111114';
    const ink = dark(bg) ? '#FFFFFF' : '#111114';
    const layers = [
      { id: `b${i}`, name: 'Accent', type: 'shape', shape: 'rect', fill: sc.accent ?? '#F472B6', startMs: 0, endMs: ms, box: { x: 0.1, y: 0.3, w: 0.2, h: 0.008 }, in: { preset: 'wipe-in', feel: 'smooth', durationMs: 600 } },
      text(`t${i}`, 'title', sc.headline, 0.34, 64, ink, 200, ms, i),
    ];
    if (p?.type === 'chart' && i === 1) layers.push({ id: `c${i}`, name: 'Chart', type: 'chart', chart: 'bar', values: [{ label: 'A', value: 3 }, { label: 'B', value: 5 }], colour: sc.accent ?? '#F472B6', startMs: 0, endMs: ms, box: { x: 0.15, y: 0.6, w: 0.7, h: 0.2 } });
    else if (sc.support) layers.push(text(`u${i}`, 'body', sc.support, 0.6, 44, ink, 600, ms, i + 1));
    return { id: `s${i + 1}`, durationMs: ms, background: bg, layout: sc.layout ?? 'center', layers };
  });
  return { name: plan.name ?? 'Clip', scenes };
}
